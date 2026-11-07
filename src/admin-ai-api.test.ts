import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {adminAiMessage,type AiAttachment} from './admin-ai.js';

test('actual SDK path delivers image bytes and reports exhausted credit without automatic retries',async()=>{
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-key';
  let stored:Buffer|undefined,calls=0,fail=false;
  const expected=await readFile('deploy/ai-fixtures/red.png');
  const pool={query:async(sql:string,params?:unknown[])=>{
    if(sql.includes('FROM admins'))return {rowCount:1,rows:[]};
    if(sql.startsWith('SELECT last_activity'))return {rowCount:1,rows:[{last_activity:new Date()}]};
    if(sql.startsWith('SELECT data,media_type'))return {rows:stored?[{data:stored,media_type:'image/png'}]:[]};
    if(sql.startsWith('INSERT INTO admin_ai_images'))stored=params![1] as Buffer;
    return {rows:[],rowCount:0};
  }} as unknown as Pool;
  const delivered:AiAttachment[]=[];
  globalThis.fetch=async(_input,init)=>{
    calls++;
    const request=JSON.parse(String(init?.body));
    assert.equal(request.tools[0].type,'image_generation');
    assert.equal(request.max_tool_calls,1);
    if(fail)return new Response(JSON.stringify({error:{message:'You have no credits remaining.',code:'credit_balance_exhausted',type:'insufficient_quota'}}),{status:429,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({id:'resp_test',object:'response',created_at:1700000000,model:'gpt-6-luna',status:'completed',
      output:[{type:'image_generation_call',id:'ig_test',status:'completed',result:expected.toString('base64')},
      {type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text:'Gambar selesai',annotations:[]}]}],
      usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    assert.equal(await adminAiMessage(pool,'628111111111','Buat gambar',undefined,undefined,pool,async image=>{delivered.push(image);}),'Gambar selesai');
    assert.equal(delivered.length,1);assert.deepEqual(delivered[0].data,expected);assert.deepEqual(stored,expected);
    fail=true;
    assert.match(await adminAiMessage(pool,'628111111111','Buat lagi')??'',/Saldo OpenAI API habis/);
    assert.equal(calls,2);
    assert.equal(delivered.length,1);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;
  }
});
