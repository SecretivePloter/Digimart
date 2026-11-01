import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {buyerMessage} from './buyer-chat.js';
import {createOrder,handlePaymentNotice} from './orders.js';
import {MidtransClient} from './midtrans.js';
import {completeOrder,orderStatus,salesReport} from './order-operations.js';

test('isolated SQL checkout: email, availability, authoritative payment, ownership, fulfillment and optional warranty',async()=>{
  const db=new PGlite();
  const adapter={query:async(sql:string,params?:any[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};},release(){}};
  const pool={...adapter,connect:async()=>adapter} as unknown as Pool;
  process.env.MIDTRANS_FEE_BPS='70';process.env.MIDTRANS_FEE_FIXED_IDR='0';process.env.MIDTRANS_ENV='sandbox';
  const buyer='628111111111',admin='628222222222',stranger='628333333333';
  let charges=0;
  const gateway=new MidtransClient('test-key','sandbox',async(_url,init)=>{
    charges++;const b=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({order_id:b.transaction_details.order_id,gross_amount:String(b.transaction_details.gross_amount),
      transaction_id:'tx-'+charges,transaction_status:'pending',actions:[{name:'generate-qr-code',url:'https://api.sandbox.midtrans.com/qr/test'}]}));
  });
  const notice=(id:string,transaction:string,total:number,status:string)=>({order_id:id,status_code:'200',gross_amount:String(total),
    transaction_id:transaction,payment_type:'qris',transaction_status:status,
    signature_key:createHash('sha512').update(id+'200'+total+'test-key').digest('hex')});
  try {
    for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile('migrations/'+name,'utf8'));
    await db.exec(`INSERT INTO admins(wa_number,name) VALUES('${admin}','TEST ADMIN');
      INSERT INTO products(catalog_number,slug,name,description) VALUES(1,'test-only','TEST ONLY','Integration fixture');
      INSERT INTO variants(product_id,name,base_price_idr,requires_email,warranty_days,stock_status) VALUES
        (1,'Email',10000,true,30,'ready'),(1,'No email',5000,false,0,'ready'),(1,'Sold out',5000,false,0,'out');`);
    assert.match(await buyerMessage(pool,buyer,'list'),/TEST ONLY/);
    assert.match(await buyerMessage(pool,buyer,'1'),/Email/);
    assert.match(await buyerMessage(pool,buyer,'3'),/habis/);
    assert.match(await buyerMessage(pool,buyer,'1'),/Kirim email/);
    assert.match(await buyerMessage(pool,buyer,'wrong'),/valid/);
    assert.match(await buyerMessage(pool,buyer,'test@example.com'),/konfirmasi beli/);
    assert.equal((await pool.query('SELECT fulfillment_email FROM conversation_states')).rows[0].fulfillment_email,'test@example.com');
    await assert.rejects(createOrder(pool,buyer,'3',gateway),/out of stock/);
    await assert.rejects(createOrder(pool,buyer,'1',gateway),/email/);
    await assert.rejects(createOrder(pool,buyer,'1',gateway,{email:'test@example.com',expectedTotal:1}),/Price changed/);
    const first=await createOrder(pool,buyer,'1',gateway,{email:'test@example.com',expectedTotal:10071});
    const repeated=await createOrder(pool,buyer,'1',gateway,{email:'test@example.com'});
    assert.equal(repeated.publicId,first.publicId);assert.equal(charges,1);
    const pending=notice(first.publicId,'tx-1',first.totalIdr,'pending');
    await handlePaymentNotice(pool,pending,'test-key');
    assert.equal((await salesReport(pool,admin)).length,0);
    await assert.rejects(completeOrder(pool,admin,first.publicId),/belum siap/);
    const settled={...pending,transaction_status:'settlement'};
    await handlePaymentNotice(pool,pending,'test-key',async()=>settled);
    await handlePaymentNotice(pool,settled,'test-key');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM message_outbox')).rows[0].n,2);
    assert.equal(await orderStatus(pool,stranger,first.publicId),null);
    await assert.rejects(completeOrder(pool,stranger,first.publicId),/ditolak/);
    assert.equal(await completeOrder(pool,admin,first.publicId),true);
    assert.equal(await completeOrder(pool,admin,first.publicId),false);
    assert.ok((await orderStatus(pool,buyer,first.publicId)).warranty_ends_at);
    assert.equal((await salesReport(pool,admin))[0].paid_orders,1);
    const second=await createOrder(pool,buyer,'2',gateway);
    await handlePaymentNotice(pool,notice(second.publicId,'tx-2',second.totalIdr,'expire'),'test-key');
    assert.equal((await orderStatus(pool,buyer,second.publicId)).status,'expired');
    assert.equal((await salesReport(pool,admin))[0].paid_orders,1);
    // Authoritative late settlement can supersede expiry, without treating expiry itself as paid.
    await handlePaymentNotice(pool,notice(second.publicId,'tx-2',second.totalIdr,'settlement'),'test-key');
    await completeOrder(pool,admin,second.publicId);
    assert.equal((await orderStatus(pool,buyer,second.publicId)).warranty_ends_at,null);
    for(const status of ['cancel','deny']) {
      const o=await createOrder(pool,buyer,'2',gateway);
      await handlePaymentNotice(pool,notice(o.publicId,'tx-'+charges,o.totalIdr,status),'test-key');
      assert.equal((await orderStatus(pool,buyer,o.publicId)).status,status==='cancel'?'cancelled':'payment_failed');
    }
    await pool.query('UPDATE products SET active=false WHERE id=1');
    await assert.rejects(createOrder(pool,buyer,'2',gateway),/not active/);
  } finally {await db.close();}
});

