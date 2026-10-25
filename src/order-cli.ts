import { database } from './services.js';
import { createOrder, handlePaymentNotice, midtransFromEnv } from './orders.js';

const [operation, first, second] = process.argv.slice(2);
const pool = database();
try {
  if (operation === 'create') {
    if (!first || !second) throw new Error('Usage: npm run order:create -- <buyer-wa-62...> <variant-id>');
    const result = await createOrder(pool, first, second, midtransFromEnv());
    console.log(JSON.stringify(result, null, 2));
  } else if (operation === 'inspect') {
    const result = await pool.query(`
      SELECT o.public_id, c.wa_number, o.product_name_snapshot, o.variant_name_snapshot,
        o.base_price_idr, o.payment_fee_idr, o.total_idr, o.status,
        p.status AS payment_status, o.created_at, o.paid_at
      FROM orders o JOIN customers c ON c.id = o.customer_id
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC LIMIT 20
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (operation === 'reconcile') {
    if (!first) throw new Error('Usage: npm run payment:reconcile -- <order-id>');
    const midtrans = midtransFromEnv();
    const status = await midtrans.getStatus(first);
    const result = await handlePaymentNotice(pool, status, process.env.MIDTRANS_SERVER_KEY!);
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Use create, inspect, or reconcile');
  }
} finally {
  await pool.end();
}
