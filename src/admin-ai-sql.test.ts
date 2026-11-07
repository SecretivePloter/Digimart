import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {adminAiMessage} from './admin-ai.js';

test('SQL AI history: separate authorization, admin isolation, reset, exact idle expiry and revoked access',async()=>{
  const db=new PGlite();
  const store={query:async(sql:string,params?:unknown[])=>{
    const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};
  }} as unknown as Pool;
  const admins=new Set(['628111111111','628222222222']);
  const auth={query:async(sql:string,params:unknown[])=>{
    assert.match(sql,/FROM admins/);return {rowCount:admins.has(String(params[0]))?1:0,rows:[]};
  }} as unknown as Pool;
  const previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-only';
  let calls=0;
  const reply=async(messages:unknown[])=>{calls++;return 'context '+messages.length;};
  const send=(phone:string,text:string)=>adminAiMessage(auth,phone,text,undefined,reply,store);
  try {
    for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile('migrations/'+name,'utf8'));
    for(const phone of admins) await store.query('INSERT INTO admins(wa_number,name) VALUES($1,$2)',[phone,'TEST']);
    assert.match(await send('628333333333','.ai')??'',/hanya/);
    await send('628111111111','.ai');await send('628222222222','.ai');
    assert.equal(await send('628111111111','first'),'context 1');
    assert.equal(await send('628111111111','second'),'context 3');
    assert.equal(await send('628222222222','other'),'context 1');
    await send('628111111111','.ai reset');
    assert.equal(await send('628111111111','after reset'),'context 1');
    assert.equal((await store.query('SELECT messages FROM admin_ai_chats WHERE phone=$1',['628222222222'])).rows[0].messages.length,2);
    await store.query("UPDATE admin_ai_mode SET last_activity=now()-interval '2 hours 1 second' WHERE phone=$1",['628111111111']);
    assert.equal(await send('628111111111','expired'),null);
    assert.equal(calls,4);
    await send('628111111111','.ai');
    admins.delete('628111111111');
    assert.equal(await send('628111111111','revoked'),null);
    assert.equal(calls,4);
    assert.match(await send('628222222222','.ai')??'',/nonaktif/);
    assert.equal(await send('628222222222','list'),null);
  } finally {
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    await db.close();
  }
});
