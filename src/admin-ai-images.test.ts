import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {adminAiMessage,type AiReply,type AiAttachment} from './admin-ai.js';

test('AI images: generation, sequential edits, original resend, isolation, reset and expired references',async()=>{
  const db=new PGlite();
  const pool={query:async(sql:string,params?:unknown[])=>{
    const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};
  }} as unknown as Pool;
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only';
  const admin='628111111111',other='628222222222';
  const generated={data:Buffer.from('generated-image'),mediaType:'image/png',filename:'test.png'};
  const deliveries:{data:Buffer;original?:boolean}[]=[];
  const sink=async(image:AiAttachment,original?:boolean)=>{deliveries.push({data:image.data,original});};
  let calls=0;
  const render=async(messages:any[]):Promise<AiReply>=>{
    calls++;
    if(calls===2) assert.deepEqual(messages.at(-1).content.at(-1).data,generated.data);
    return {text:'Gambar siap',image:generated};
  };
  const send=(phone:string,text:string,reply=render)=>adminAiMessage(pool,phone,text,undefined,reply,pool,sink);
  try {
    for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile('migrations/'+name,'utf8'));
    for(const phone of [admin,other]) await pool.query('INSERT INTO admins(wa_number,name) VALUES($1,$2)',[phone,'TEST']);
    assert.match(await send('628333333333','.ai')??'',/hanya/);assert.equal(calls,0);
    await send(admin,'.ai');await send(other,'.ai');
    assert.equal(await send(admin,'Buat gambar'),'Gambar siap');
    assert.equal(await send(admin,'Ubah latarnya'),'Gambar siap');
    assert.equal(deliveries.length,2);
    assert.match(await send(admin,'.ai file')??'',/asli/);assert.equal(calls,2);
    assert.equal(deliveries[2].original,true);
    assert.match(await send(other,'.ai file')??'',/Belum ada/);assert.equal(deliveries.length,3);
    const history=JSON.stringify((await pool.query('SELECT messages FROM admin_ai_chats WHERE phone=$1',[admin])).rows[0].messages);
    assert.ok(!history.includes(generated.data.toString('base64')));
    await send(admin,'.ai reset');assert.match(await send(admin,'.ai file')??'',/Belum ada/);
    // A captionless upload is kept for a later edit instruction, without image bytes in chat JSON.
    await adminAiMessage(pool,admin,'',async()=>generated,async()=> 'Gambar diterima',pool,sink);
    assert.match(await send(admin,'.ai file')??'',/asli/);
    await send(admin,'.ai');assert.equal((await pool.query('SELECT 1 FROM admin_ai_images WHERE phone=$1',[admin])).rowCount,0);
    await send(admin,'.ai');await send(admin,'Buat lagi');
    await pool.query("UPDATE admin_ai_mode SET last_activity=now()-interval '2 hours 1 second' WHERE phone=$1",[admin]);
    assert.equal(await send(admin,'list'),null);
    assert.equal((await pool.query('SELECT 1 FROM admin_ai_images WHERE phone=$1',[admin])).rowCount,0);
  } finally {
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    await db.close();
  }
});
