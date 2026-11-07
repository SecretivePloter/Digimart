import test from 'node:test';
import assert from 'node:assert/strict';
import {messageRoute,groupReply} from './group-chat.js';
import type {Pool} from 'pg';
test('group sender is participant, with alternate phone for LID; broadcasts ignored',()=>{
 assert.deepEqual(messageRoute({remoteJid:'123@g.us',participant:'987@lid',participantAlt:'628123456789@s.whatsapp.net'}),{isGroup:true,sessionId:'628123456789'});
 assert.equal(messageRoute({remoteJid:'123@g.us'}),null);
 assert.equal(messageRoute({remoteJid:'status@broadcast'}),null);
 assert.deepEqual(messageRoute({remoteJid:'628123456789@s.whatsapp.net'}),{isGroup:false,sessionId:'628123456789'});
});
test('group catalog replies without creating buyer state, media and sensitive requests stay private',async()=>{
 const pool={query:async(sql:string)=>{assert.match(sql,/SELECT/);return {rows:[{catalog_number:1,name:'Produk',stock_status:'ready'}]};}} as unknown as Pool;
 assert.match((await groupReply(pool,'list'))!,/Produk/);
 assert.match((await groupReply(pool,'status ORD-TEST'))!,/chat pribadi/);
 assert.equal(await groupReply(pool,'',true),null);
});
