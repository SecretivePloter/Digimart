// Runs the deployed buyer checkout against live catalog inside a rolled-back transaction.
// No WhatsApp socket, external payment call, persisted test order or outgoing message.
import assert from 'node:assert/strict';
import { database } from '../dist/services.js';
import { buyerMessage } from '../dist/buyer-chat.js';
import { verifyManualConfig } from '../dist/payment-config.js';
assert.equal(process.env.PAYMENT_PROVIDER,'qris_manual');
assert.equal(process.env.PAYMENTS_ENABLED,'true');
await verifyManualConfig();
const pool=database(),c=await pool.connect();
await c.query('BEGIN');
const adapter={release(){},async query(sql,params){
 if(sql==='BEGIN')return c.query('SAVEPOINT probe_nested');
 if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT probe_nested');
 if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT probe_nested');
 return c.query(sql,params);
}};
const wrapped={...adapter,connect:async()=>adapter};
try {
 const v=(await c.query("SELECT v.id,v.base_price_idr,v.requires_email,p.slug FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active AND p.active AND v.stock_status<>'out' ORDER BY v.id LIMIT 1")).rows[0];
 assert.ok(v);
 const phone='629999999999';
 await buyerMessage(wrapped,phone,'list');await buyerMessage(wrapped,phone,v.slug);
 const variants=(await c.query('SELECT id FROM variants WHERE product_id=(SELECT id FROM products WHERE slug=$1) AND active ORDER BY id',[v.slug])).rows;
 await buyerMessage(wrapped,phone,String(variants.findIndex(x=>x.id===v.id)+1));
 if(v.requires_email)await buyerMessage(wrapped,phone,'rollback-probe@example.invalid');
 const reply=await buyerMessage(wrapped,phone,'konfirmasi beli');
 assert.match(reply,/QRIS manual/);assert.match(reply,/MUGENWORKLABS/);
 const id=reply.match(/ORD-[A-F0-9]{16}/)[0];
 const o=(await c.query('SELECT o.total_idr,o.payment_fee_idr,o.payment_status,p.provider FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.public_id=$1',[id])).rows[0];
 assert.equal(o.provider,'qris_manual');assert.equal(Number(o.payment_fee_idr),0);
 assert.equal(Number(o.total_idr),Number(v.base_price_idr));assert.equal(o.payment_status,'pending');
 console.log('PASS deployed checkout: qris_manual, original QR readable, product price, zero fee, pending unpaid; all probe rows rolled back.');
} finally {await c.query('ROLLBACK');c.release();await pool.end();}
