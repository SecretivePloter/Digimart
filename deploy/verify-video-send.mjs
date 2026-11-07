import makeWASocket,{useMultiFileAuthState} from '@whiskeysockets/baileys';
import pino from 'pino';
import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {withDownloadedMedia} from '../dist/downloader.js';
const phone=(process.env.WA_TEST_NUMBERS??'').split(',').map(s=>s.trim()).find(s=>/^[1-9][0-9]{7,14}$/.test(s));
if(!phone)throw Error('No authorized test number configured');
const {state,saveCreds}=await useMultiFileAuthState(process.env.WA_AUTH_DIR);
const sock=makeWASocket({auth:state,logger:pino({level:'silent'})});
sock.ev.on('creds.update',saveCreds);
const timer=setTimeout(()=>process.exit(2),180000);
let started=false,id,receipt=false;
sock.ev.on('messages.update',updates=>{for(const u of updates)if(u.key.id===id&&u.update.status){console.log('RECEIPT status='+u.update.status);if(u.update.status>=3)receipt=true;}});
sock.ev.on('connection.update',async({connection})=>{
  if(connection!=='open'||started)return;started=true;
  try {
    let sentPath;
    await withDownloadedMedia('video-validation','https://www.facebook.com/share/v/1J9AAkbfWQ/','.fb',async(path,kind)=>{
      assert.equal(kind,'video');sentPath=path;
      console.log('UPLOAD_START bytes='+(await stat(path)).size);
      const msg=await sock.sendMessage(phone+'@s.whatsapp.net',{video:{url:path},mimetype:'video/mp4',caption:'Uji perbaikan video Facebook. Mohon putar sampai selesai dan cek suaranya.'});
      id=msg?.key.id;assert.ok(id);assert.ok((await stat(path)).size>0);
      console.log('UPLOAD_RELAY_COMPLETE id='+id);
    });
    await assert.rejects(stat(sentPath));console.log('TEMP_CLEANUP_AFTER_SEND PASS');
    for(let i=0;i<30&&!receipt;i++)await new Promise(r=>setTimeout(r,1000));
    console.log('DEVICE_RECEIPT '+(receipt?'PASS':'UNCONFIRMED'));
  }catch(e){console.error(e.message);process.exitCode=1;}
  finally{clearTimeout(timer);sock.end(undefined);setTimeout(()=>process.exit(process.exitCode??0),1000);}
});
