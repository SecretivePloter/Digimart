import type { Pool } from 'pg';
import { enqueue, handlePaymentNotice, midtransFromEnv, validEmail } from './orders.js';
import { activeAdmin } from './catalog-manage.js';

export async function orderStatus(pool: Pool, phone: string, id: string) {
  const admin = await activeAdmin(pool,phone);
  const result=await pool.query(`SELECT o.public_id,o.product_name_snapshot,o.variant_name_snapshot,
    o.status,o.total_idr,o.fulfillment_email,o.warranty_ends_at,
    CASE WHEN o.payment_environment='qris_manual' THEN o.payment_status ELSE p.status END AS payment_status
    FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN payments p ON p.order_id=o.id
    WHERE o.public_id=$1 AND (c.wa_number=$2 OR $3)`,[id,phone,admin]);
  return result.rows[0] ?? null;
}

export async function completeOrder(pool: Pool, phone: string, id: string) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const admin=(await client.query('SELECT id FROM admins WHERE wa_number=$1 AND active FOR SHARE',[phone])).rows[0];
    if(!admin) throw new Error('Akses admin ditolak.');
    const order=(await client.query(`SELECT o.*,c.wa_number FROM orders o JOIN customers c ON c.id=o.customer_id
      WHERE public_id=$1 FOR UPDATE OF o`,[id])).rows[0];
    if(!order) throw new Error('Pesanan tidak ditemukan.');
    if(order.status==='completed') {await client.query('COMMIT');return false;}
    if(!order.paid_at || !['processing','paid'].includes(order.status) ||
      (order.requires_email_snapshot && !order.fulfillment_email)) throw new Error('Pesanan belum siap diselesaikan.');
    await client.query(`UPDATE orders SET status='completed',fulfillment_status='completed',completed_at=now(),completed_by_admin_id=$2,
      warranty_starts_at=CASE WHEN warranty_days_snapshot>0 THEN now() ELSE NULL END,
      warranty_ends_at=CASE WHEN warranty_days_snapshot>0 THEN now()+warranty_days_snapshot*interval '1 day' ELSE NULL END
      WHERE id=$1`,[order.id,admin.id]);
    await client.query(`INSERT INTO order_events(order_id,event_type,actor_type,actor_ref)
      VALUES($1,'completed','admin',$2)`,[order.id,phone]);
    await enqueue(client,order.wa_number,'text',{text:`Pesanan ${id} selesai. Admin telah mengonfirmasi pengiriman manual produk. ${order.warranty_days_snapshot>0?'Garansi mengikuti ketentuan produk.':'Produk ini tidak memiliki masa garansi.'}`});
    await client.query('COMMIT');return true;
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function supplyEmail(pool: Pool, phone: string, id: string, email: string) {
  if(!validEmail(email)) throw new Error('Email tidak valid.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const order=(await client.query(`UPDATE orders o SET fulfillment_email=$3,status='processing'
      FROM customers c WHERE o.customer_id=c.id AND c.wa_number=$1 AND o.public_id=$2
      AND o.status='awaiting_customer_data' AND o.requires_email_snapshot AND o.paid_at IS NOT NULL
      RETURNING o.id,o.product_name_snapshot,o.variant_name_snapshot`,[phone,id,email])).rows[0];
    if(!order) throw new Error('Pesanan tidak ditemukan atau tidak memerlukan email.');
    await client.query(`INSERT INTO message_outbox(recipient_wa_number,message_type,payload)
      SELECT wa_number,'order_paid',$1 FROM admins WHERE active`,[JSON.stringify({order_id:id,phone,email,
        product:order.product_name_snapshot,variant:order.variant_name_snapshot})]);
    await client.query('COMMIT');
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}

export async function salesReport(pool: Pool, phone: string) {
  if(!await activeAdmin(pool,phone)) throw new Error('Akses admin ditolak.');
  return (await pool.query(`SELECT payment_environment,count(*)::int AS paid_orders,
    COALESCE(sum(total_idr),0)::text AS gross_idr,count(*) FILTER(WHERE status='completed')::int AS completed_orders
    FROM orders WHERE paid_at IS NOT NULL GROUP BY payment_environment`)).rows;
}

export async function reconcilePayments(pool: Pool) {
  const mode=process.env.MIDTRANS_ENV ?? 'sandbox';
  const orders=await pool.query(`SELECT public_id FROM orders WHERE
    status IN ('payment_setup','awaiting_payment') AND payment_environment=$1
    ORDER BY payment_checked_at NULLS FIRST,created_at LIMIT 50`,[mode]);
  if(!orders.rowCount) return;
  const gateway=midtransFromEnv();
  for(const order of orders.rows) {
    try {
      const status=await gateway.getStatus(order.public_id);
      await handlePaymentNotice(pool,status,process.env.MIDTRANS_SERVER_KEY!);
    } catch {console.error('Payment reconciliation deferred for order',order.public_id);}
    finally {await pool.query('UPDATE orders SET payment_checked_at=now() WHERE public_id=$1',[order.public_id]);}
  }
}
