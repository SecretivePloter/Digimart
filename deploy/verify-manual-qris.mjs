// Run only on an isolated restored database, never production.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { startManualOrder,submitManualEvidence,reviewManualPayment } from '../dist/manual-payments.js';
import { completeOrder } from '../dist/order-operations.js';
if(!process.env.DATABASE_URL?.includes('lidealabs_qrischeck_')) throw Error('Isolated database required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const dir=await mkdtemp(join(tmpdir(),'qrischeck-'));
process.env.MANUAL_PAYMENT_EVIDENCE_DIR=dir;
try {
 const tag=String(Date.now());
 const admin='629999990001',buyer='629999990002',other='629999990003';
 await pool.query("INSERT INTO admins(wa_number,name) VALUES($1,'Isolated test admin')",[admin]);
 const p=(await pool.query("INSERT INTO products(catalog_number,slug,name) SELECT COALESCE(max(catalog_number),0)+1,$1,'ISOLATED QRIS TEST' FROM products RETURNING id",['isolated-'+tag])).rows[0];
 const v=(await pool.query("INSERT INTO variants(product_id,name,base_price_idr) VALUES($1,'Test',12345) RETURNING id",[p.id])).rows[0];
 const orders=await Promise.all(Array.from({length:5},()=>startManualOrder(pool,buyer,String(v.id))));
 assert.equal(new Set(orders.map(o=>o.id)).size,1);
 const first=orders[0],second=await startManualOrder(pool,other,String(v.id));
 await submitManualEvidence(pool,buyer,first.id,{data:Buffer.from('fixture-one'),mime:'image/png'});
 await submitManualEvidence(pool,other,second.id,{data:Buffer.from('fixture-two'),mime:'image/png'});
 const approvals=await Promise.allSettled([
   reviewManualPayment(pool,admin,first.id,'approve','','CONCURRENT-REF'),
   reviewManualPayment(pool,admin,second.id,'approve','','CONCURRENT-REF')]);
 assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);
 const paid=(await pool.query("SELECT public_id FROM orders WHERE public_id=ANY($1) AND paid_at IS NOT NULL",[[first.id,second.id]])).rows;
 assert.equal(paid.length,1);
 await Promise.all(Array.from({length:5},()=>reviewManualPayment(pool,admin,paid[0].public_id,'approve','','CONCURRENT-REF')));
 const events=(await pool.query("SELECT count(*)::int n FROM order_events WHERE event_type='manual_payment_approved' AND external_event_key='manual:CONCURRENT-REF'")).rows[0];
 assert.equal(events.n,1);
 const done=await Promise.all(Array.from({length:5},()=>completeOrder(pool,admin,paid[0].public_id)));
 assert.equal(done.filter(Boolean).length,1);
 console.log('PASS PostgreSQL: concurrent checkout reused one order; duplicate reference settled only one order; concurrent approval/completion recorded once.');
} finally {await pool.end();await rm(dir,{recursive:true,force:true});}
