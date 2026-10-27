import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { zipSync, strToU8 } from 'fflate';
import { createServer } from 'node:http';
import type { Pool } from 'pg';
import { productsFromWorkbook } from './catalog-xlsx.js';
import { catalogForAdmin, saveProduct, type CatalogProduct } from './catalog-manage.js';
import { adminMessage } from './admin-wa.js';
import { adminHttp } from './admin-http.js';
import { passwordHash } from './admin-auth.js';
import { listCatalog, productDetail } from './catalog.js';

test('spreadsheet import combines repeated products and excludes confidential fields and notes',()=>{
  const xml=`<worksheet><sheetData><row r="3"><c r="C3" t="inlineStr"><is><t>Nama Item</t></is></c><c r="D3" t="inlineStr"><is><t>Varian</t></is></c><c r="F3" t="inlineStr"><is><t>Harga</t></is></c></row>
    <row r="4"><c r="C4" t="inlineStr"><is><t>Example</t></is></c><c r="D4" t="inlineStr"><is><t>Basic</t></is></c><c r="E4"><v>123</v></c><c r="F4"><v>9000</v></c><c r="H4" t="inlineStr"><is><t>SECRET SELLER</t></is></c></row>
    <row r="5"><c r="C5" t="inlineStr"><is><t>Example</t></is></c><c r="D5" t="inlineStr"><is><t>Plus</t></is></c><c r="F5"><v>20000</v></c></row>
    <row r="6"><c r="C6" t="inlineStr"><is><t>PRIVATE NOTE</t></is></c></row></sheetData></worksheet>`;
  const data=productsFromWorkbook(zipSync({'xl/worksheets/sheet1.xml':strToU8(xml)}));
  assert.equal(data.length,1);assert.equal(data[0].variants.length,2);
  assert.equal(data[0].variants[0].base_price_idr,9000);
  assert.equal(data[0].active,false);assert.equal(data[0].variants[0].stock_status,'out');
  assert.doesNotMatch(JSON.stringify(data),/SECRET|PRIVATE|123/);
});

test('admin CRUD enforces authorization, revisions, publication rules and preserves order history',async()=>{
  const db=new PGlite();
  const adapter={query:async(sql:string,params?:any[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};},release:()=>{}};
  const pool={...adapter,connect:async()=>adapter} as unknown as Pool;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    for(const name of ['001_initial.sql','002_warranty_label.sql','003_payment_setup.sql','004_catalog_admin.sql'])
      await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
    const admin='628111111111', password='test-password-very-long';
    await pool.query('INSERT INTO admins(wa_number,name,password_hash) VALUES($1,$2,$3)',[admin,'Test',passwordHash(password)]);
    assert.match((await adminMessage(pool,'628222222222','/admin tambah example | Example'))!,/Akses admin/);
    assert.equal((await catalogForAdmin(pool)).length,0);
    assert.match((await adminMessage(pool,admin,'/admin tambah example | Example'))!,/dibuat/);
    assert.match((await adminMessage(pool,admin,'/admin deskripsi example | Description'))!,/berhasil/);
    assert.match((await adminMessage(pool,admin,'/admin ketentuan example | Terms'))!,/berhasil/);
    assert.match((await adminMessage(pool,admin,'/admin varian example | Basic | 10000'))!,/berhasil/);
    assert.equal((await listCatalog(pool)).length,0);
    assert.match((await adminMessage(pool,admin,'/admin publikasi example'))!,/Lengkapi/);
    let p=(await catalogForAdmin(pool))[0]; const vid=p.variants[0].id;
    assert.match((await adminMessage(pool,admin,`/admin ubah-varian example | ${vid} | Basic | 12000 | out | 23 | 1 bulan | true | true`))!,/berhasil/);
    assert.match((await adminMessage(pool,admin,'/admin publikasi example'))!,/berhasil/);
    const visible=await productDetail(pool,'example');
    assert.equal(visible.variants[0].warranty_label,'1 bulan');
    assert.doesNotMatch(JSON.stringify(visible),/warranty_days|password_hash/);
    p=(await catalogForAdmin(pool))[0];const stale=structuredClone(p);
    p.description='Changed';await saveProduct(pool,p,admin);
    await assert.rejects(saveProduct(pool,stale,admin),/diubah admin lain/);
    await pool.query("INSERT INTO customers(wa_number) VALUES('628333333333')");
    await pool.query(`INSERT INTO orders(public_id,customer_id,variant_id,product_name_snapshot,variant_name_snapshot,terms_snapshot,base_price_idr,status)
      VALUES('ORD-TEST',1,$1,'Old name','Basic','Old terms',10000,'awaiting_stock')`,[vid]);
    assert.match((await adminMessage(pool,admin,'/admin arsip example'))!,/berhasil/);
    assert.equal((await listCatalog(pool)).length,0);
    assert.equal((await pool.query("SELECT product_name_snapshot FROM orders WHERE public_id='ORD-TEST'")).rows[0].product_name_snapshot,'Old name');
    assert.ok((await pool.query('SELECT id FROM catalog_events')).rows.length>=6);
    server=createServer(async(req,res)=>{await adminHttp(pool,req,res,new URL(req.url!,'http://localhost').pathname);});
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
    const port=(server.address() as any).port;process.env.PORT=String(port);
    const url=`http://127.0.0.1:${port}/admin/api/catalog`;
    assert.equal((await fetch(url)).status,401);
    const auth='Basic '+Buffer.from(admin+':'+password).toString('base64');
    const headers={Authorization:auth,'Content-Type':'application/json'};
    const result=await fetch(url,{headers});assert.equal(result.status,200);
    p=(await result.json())[0];p.description='Web updated';
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(p)})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(p)})).status,200);
    assert.equal((await catalogForAdmin(pool))[0].description,'Web updated');
    await pool.query('UPDATE admins SET active=false WHERE wa_number=$1',[admin]);
    assert.equal((await fetch(url,{headers})).status,401);
    assert.match((await adminMessage(pool,admin,'/admin list'))!,/Akses admin/);
  } finally {
    delete process.env.PORT;
    if(server) {server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    await db.close();
  }
});
