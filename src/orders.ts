import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { calculateQuote, feePolicyFromEnv } from './quote.js';
import { MidtransClient, paymentState, verifyNotification, type MidtransNotification } from './midtrans.js';

type VariantRow = {
  id: string; name: string; base_price_idr: string; stock_status: string;
  warranty_days: number; requires_email: boolean;
  product_name: string; terms: string;
};

export function midtransFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!env.MIDTRANS_SERVER_KEY) throw new Error('MIDTRANS_SERVER_KEY is required');
  const mode = env.MIDTRANS_ENV ?? 'sandbox';
  if (mode !== 'sandbox' && mode !== 'production') throw new Error('Invalid MIDTRANS_ENV');
  return new MidtransClient(env.MIDTRANS_SERVER_KEY, mode);
}

export async function createOrder(pool: Pool, phone: string, variantId: string, midtrans: MidtransClient) {
  if (!/^[1-9][0-9]{7,14}$/.test(phone) || !/^\d+$/.test(variantId)) throw new Error('Invalid customer or variant');
  const policy = feePolicyFromEnv();
  const client = await pool.connect();
  let publicId = '';
  let totalIdr = 0;
  let stockStatus = '';
  try {
    await client.query('BEGIN');
    const variant = await client.query<VariantRow>(`
      SELECT v.id, v.name, v.base_price_idr, v.stock_status, v.warranty_days,
        v.requires_email, p.name AS product_name, p.terms
      FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = $1 AND v.active AND p.active FOR SHARE OF v, p
    `, [variantId]);
    const selected = variant.rows[0];
    if (!selected) throw new Error('Variant is not active');
    const quote = calculateQuote(Number(selected.base_price_idr), policy);
    totalIdr = quote.total_idr;
    stockStatus = selected.stock_status;
    const customer = await client.query<{ id: string }>(`
      INSERT INTO customers(wa_number) VALUES ($1)
      ON CONFLICT (wa_number) DO UPDATE SET last_seen_at = now()
      RETURNING id
    `, [phone]);
    // Reuse an open order after repeated commands or an ambiguous network timeout.
    const existing=await client.query<{public_id:string;status:string;total_idr:string;qr_code_url:string|null}>(`
      SELECT o.public_id,o.status,o.total_idr,p.qr_code_url
      FROM orders o LEFT JOIN payments p ON p.order_id=o.id
      WHERE o.customer_id=$1 AND o.variant_id=$2
        AND o.status IN ('awaiting_stock','payment_setup','awaiting_payment')
      ORDER BY o.created_at DESC LIMIT 1 FOR UPDATE OF o
    `,[customer.rows[0].id,selected.id]);
    if(existing.rows[0]) {
      const order=existing.rows[0];
      await client.query('COMMIT');
      if(order.status==='awaiting_payment' && order.qr_code_url)
        return {publicId:order.public_id,status:'awaiting_payment' as const,totalIdr:Number(order.total_idr),qrUrl:order.qr_code_url};
      if(order.status==='awaiting_stock')
        return {publicId:order.public_id,status:'awaiting_stock' as const,totalIdr:Number(order.total_idr)};
      return {publicId:order.public_id,status:'payment_setup' as const,totalIdr:Number(order.total_idr)};
    }
    publicId = 'ORD-' + randomBytes(8).toString('hex').toUpperCase();
    await client.query(`
      INSERT INTO orders(public_id, customer_id, variant_id, product_name_snapshot,
        variant_name_snapshot, terms_snapshot, base_price_idr, payment_fee_idr, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [publicId, customer.rows[0].id, selected.id, selected.product_name,
      selected.name, selected.terms, quote.base_price_idr, quote.payment_fee_idr,
      stockStatus === 'out' ? 'awaiting_stock' : 'payment_setup']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (stockStatus === 'out') return { publicId, status: 'awaiting_stock' as const, totalIdr };

  // The order exists before the external call. A timeout leaves payment_setup for reconciliation,
  // and must never be retried blindly with a new order ID.
  const charge = await midtrans.chargeQris(publicId, totalIdr, phone);
  const saved = await pool.query(`
    WITH payment AS (
      INSERT INTO payments(order_id, provider_transaction_id, status, amount_idr, qr_code_url, expires_at)
      SELECT id, $2, 'pending', $3, $4, now() + interval '15 minutes'
      FROM orders WHERE public_id = $1
      ON CONFLICT (order_id, provider) DO NOTHING RETURNING order_id
    )
    UPDATE orders SET status = 'awaiting_payment'
    WHERE public_id = $1 AND status = 'payment_setup' AND EXISTS (SELECT 1 FROM payment)
    RETURNING id
  `, [publicId, charge.transactionId, totalIdr, charge.qrUrl]);
  if (!saved.rowCount) throw new Error('Charge created; order requires reconciliation');
  return { publicId, status: 'awaiting_payment' as const, totalIdr, qrUrl: charge.qrUrl };
}

export async function handlePaymentNotice(
  pool: Pool, notice: MidtransNotification, serverKey: string,
  verifyRemote?: (orderId: string) => Promise<MidtransNotification>,
) {
  if (!verifyNotification(notice, serverKey)) throw new Error('Invalid Midtrans signature');
  const authoritative = verifyRemote ? await verifyRemote(notice.order_id) : notice;
  if (authoritative.order_id !== notice.order_id ||
      !verifyNotification(authoritative, serverKey)) throw new Error('Midtrans status verification failed');
  const state = paymentState(authoritative);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      id: string; status: string; total_idr: string; phone: string;
      variant_name_snapshot: string;
      requires_email: boolean;
    }>(`
      SELECT o.id, o.status, o.total_idr, c.wa_number AS phone,
        o.variant_name_snapshot, v.requires_email
      FROM orders o JOIN customers c ON c.id = o.customer_id
      JOIN variants v ON v.id=o.variant_id
      WHERE o.public_id = $1 FOR UPDATE OF o
    `, [notice.order_id]);
    const order = result.rows[0];
    if (!order) throw new Error('Unknown order');
    if (Number(authoritative.gross_amount) !== Number(order.total_idr) ||
        authoritative.payment_type !== 'qris') throw new Error('Payment details mismatch');
    const payment = await client.query<{ id: string; provider_transaction_id: string }>(`
      SELECT id, provider_transaction_id FROM payments WHERE order_id = $1 FOR UPDATE
    `, [order.id]);
    if (!payment.rows[0] || payment.rows[0].provider_transaction_id !== authoritative.transaction_id) {
      throw new Error('Unknown transaction');
    }
    if (state === 'paid' && ['awaiting_payment', 'expired'].includes(order.status)) {
      await client.query(`
        UPDATE payments SET status = 'settlement', settled_at = now() WHERE id = $1
      `, [payment.rows[0].id]);
      await client.query(`
        UPDATE orders SET status = 'awaiting_customer_data', paid_at = now()
        WHERE id = $1
      `, [order.id]);
      if(order.requires_email) await enqueue(client, order.phone, 'request_email', {
        order_id: notice.order_id, text: 'Pembayaran berhasil. Kirim Gmail Anda untuk diproses admin.',
      });
      await enqueueAdmins(client, 'order_paid', { order_id: notice.order_id, phone: order.phone, variant: order.variant_name_snapshot });
    } else if (state === 'expired' && order.status === 'awaiting_payment') {
      await client.query(`UPDATE payments SET status = 'expire' WHERE id = $1`, [payment.rows[0].id]);
      await client.query(`UPDATE orders SET status = 'expired' WHERE id = $1`, [order.id]);
      await enqueue(client, order.phone, 'order_expired', {
        order_id: notice.order_id, text: 'QRIS kedaluwarsa. Pesanan dibatalkan. Silakan buat pesanan baru.',
      });
    }
    await client.query('COMMIT');
    return { orderId: notice.order_id, state };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function enqueue(client: PoolClient, phone: string, type: string, payload: unknown) {
  await client.query(
    'INSERT INTO message_outbox(recipient_wa_number, message_type, payload) VALUES ($1,$2,$3)',
    [phone, type, JSON.stringify(payload)],
  );
}

async function enqueueAdmins(client: PoolClient, type: string, payload: unknown) {
  await client.query(`
    INSERT INTO message_outbox(recipient_wa_number, message_type, payload)
    SELECT wa_number, $1, $2 FROM admins WHERE active
  `, [type, JSON.stringify(payload)]);
}
