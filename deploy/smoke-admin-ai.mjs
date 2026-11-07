import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const fixtures=process.env.AI_TEST_FIXTURES_DIR || root+'/deploy/ai-fixtures';
const require=createRequire(root+'/package.json');
const {Pool}=require('pg');
const {zipSync,strToU8}=require('fflate');
const {adminAiMessage}=await import(pathToFileURL(root+'/dist/admin-ai.js'));
const {docxText,readWhatsAppAttachment}=await import(pathToFileURL(root+'/dist/ai-media.js'));
const {buyerMessage}=await import(pathToFileURL(root+'/dist/buyer-chat.js'));
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
const client=await pool.connect();
const adapter={query:(...args)=>client.query(...args)};
const phone='6280000000999';
const send=(text,attachment)=>adminAiMessage(adapter,phone,text,attachment?async()=>attachment:undefined);
try {
 await client.query('BEGIN');
 assert.equal((await client.query('SELECT 1 FROM admins WHERE wa_number=$1',[phone])).rowCount,0);
 await client.query('INSERT INTO admins(wa_number,name) VALUES($1,$2)',[phone,'TEMPORARY AI SMOKE, ROLLBACK']);
 assert.match(await adminAiMessage(adapter,'6280000000998','.ai'),/hanya/);
 assert.match(await send('.ai'),/Mode AI aktif/);
 assert.match(await send('Ingat kode APPLE742. Jawab hanya APPLE742.'),/APPLE742/);
 assert.match(await send('Apa kode yang tadi saya kirim? Jawab hanya kodenya.'),/APPLE742/);
 console.log('PASS live OpenAI text and follow-up context');
 for(const [ext,mime] of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']]) {
  const answer=await send('Apa warna dominan gambar ini? Jawab satu kata bahasa Indonesia.',{data:await readFile(fixtures+'/red.'+ext),mediaType:mime,filename:'red.'+ext});
  assert.match(answer,/merah/i);console.log('PASS live OpenAI '+ext.toUpperCase());
 }
 const pdf=await send('Apa kode tes pada dokumen ini? Jawab hanya kodenya.',{data:await readFile(fixtures+'/sample.pdf'),mediaType:'application/pdf',filename:'sample.pdf'});
 assert.match(pdf,/APPLE742/);console.log('PASS live OpenAI PDF');
 for(const format of ['TXT','DOCX']) {
  const data=format==='TXT'?Buffer.from('TEST CODE: BANANA913'):Buffer.from(docxText(Buffer.from(zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>TEST CODE: BANANA913</w:t></w:r></w:p></w:body></w:document>')}))));
  assert.match(await send('Apa kode tes dalam lampiran ini? Jawab hanya kodenya.',{data,mediaType:'text/plain',filename:'test.'+format.toLowerCase()}),/BANANA913/);
  console.log('PASS live OpenAI '+format);
 }
 assert.match(await send('.ai reset'),/dihapus/);
 assert.equal((await client.query('SELECT 1 FROM admin_ai_chats WHERE phone=$1',[phone])).rowCount,0);
 assert.equal((await client.query('SELECT 1 FROM admin_ai_mode WHERE phone=$1',[phone])).rowCount,1);
 assert.match(await send('.ai'),/nonaktif/);
 assert.equal(await send('list'),null);
 await send('.ai');
 await client.query("UPDATE admin_ai_mode SET last_activity=now()-interval '2 hours 1 second' WHERE phone=$1",[phone]);
 assert.equal(await send('list'),null);
 console.log('PASS real PostgreSQL reset, exit, and simulated two-hour idle expiry');
 await assert.rejects(readWhatsAppAttachment({message:{documentMessage:{mimetype:'application/pdf',fileLength:8*1024*1024+1}}}),/8 MB/);
 await assert.rejects(readWhatsAppAttachment({message:{documentMessage:{mimetype:'application/zip',fileLength:10}}}),/Format/);
 console.log('PASS over-8MB and unsupported format rejected before download');
 const catalog=await buyerMessage(adapter,phone,'list');assert.ok(catalog.length>20);
 console.log('PASS live catalog handler in rollback transaction');
} catch(e){console.log('FAIL smoke',e.name,e.code||'',String(e.message).slice(0,160));process.exitCode=1;}
finally {await client.query('ROLLBACK');client.release();await pool.end();console.log('Temporary database changes rolled back; no WhatsApp message sent.');}
