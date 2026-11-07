// Actual API calls use image-generation quota. No WhatsApp socket or real customer data.
// --isolated uses PGlite before deployment; default uses PostgreSQL with final ROLLBACK.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {adminAiMessage} from '../dist/admin-ai.js';
let pg,client,db;
const isolated=process.argv.includes('--isolated');
const offline=process.argv.includes('--offline');
const modelMode=offline?'simulated model (no API call)':'actual OpenAI';
if(isolated){
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();
 for(const n of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+n,'utf8'));
}
else {pg=new Pool({connectionString:process.env.DATABASE_URL});client=await pg.connect();await client.query('BEGIN');}
const pool={query:async(sql,params)=>{
 if(!isolated)return client.query(sql,params);
 const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};
}};
const phone='6280000000997';
const outputs=[];
const dir=await mkdtemp(join(tmpdir(),'digimart-image-smoke-'));
const sink=async(image,original)=>{
 assert.equal(image.mediaType,'image/png');
 assert.ok(image.data.length>1000);
 assert.deepEqual(image.data.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 if(!original){outputs.push(image.data);await writeFile(join(dir,'image-'+outputs.length+'.png'),image.data,{mode:0o600});}
 console.log('PASS image output bytes='+image.data.length+', original='+Boolean(original));
};
let simulatedCalls=0;
const simulated=async()=>({text:'Synthetic image output',image:{
 data:await readFile('deploy/ai-fixtures/'+(++simulatedCalls===1?'blue.png':'red.png')),
 mediaType:'image/png',filename:'test.png'}});
const send=text=>adminAiMessage(pool,phone,text,undefined,offline?simulated:undefined,pool,sink);
try {
 assert.equal((await pool.query('SELECT 1 FROM admins WHERE wa_number=$1',[phone])).rowCount,0);
 await pool.query('INSERT INTO admins(wa_number,name) VALUES($1,$2)',[phone,'TEMP IMAGE SMOKE, ROLLBACK']);
 await send('.ai');
 const first=await send('Buatkan gambar ikon persegi biru di atas latar putih, tanpa teks, bentuk sederhana. Buat gambar sungguhan menggunakan tool image_generation.');
 assert.equal(outputs.length,1,'Expected generated PNG, reply: '+first);
 console.log('PASS image generation path: '+modelMode);
 const second=await send('Edit gambar terakhir itu: ubah persegi birunya menjadi merah. Tetap satu persegi, latar putih. Gunakan tool image_generation untuk mengedit referensi, kirim gambar hasilnya.');
 assert.equal(outputs.length,2,'Expected edited PNG, reply: '+second);
 assert.notDeepEqual(outputs[0],outputs[1]);
 console.log('PASS follow-up image edit with persisted reference: '+modelMode);
 await send('.ai file');
 assert.equal(outputs.length,2);
 await send('.ai reset');
 assert.equal((await pool.query('SELECT 1 FROM admin_ai_images WHERE phone=$1',[phone])).rowCount,0);
 console.log('PASS reset removes image reference, mode stays enabled');
 console.log('Synthetic image evidence:',dir);
} catch(e){console.log('FAIL image smoke:',e.message);process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK');client.release();await pg.end();}if(db)await db.close();console.log('Temporary database changes discarded. No WhatsApp message sent.');}
