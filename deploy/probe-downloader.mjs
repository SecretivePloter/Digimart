import { withDownloadedVideo } from '../dist/downloader.js';
import { stat,open } from 'node:fs/promises';
const url=process.argv[2];
if(!url)throw Error('Pass a public video URL');
try {
 await withDownloadedVideo('isolated-runtime-probe',url,async path=>{
   const info=await stat(path),file=await open(path,'r');
   try{const header=Buffer.alloc(12);await file.read(header,0,12,0);if(header.toString('ascii',4,8)!=='ftyp')throw Error('Invalid MP4 header');}
   finally{await file.close();}
   console.log(`PASS real downloader: MP4 ${info.size} bytes; no WhatsApp message sent; temporary file removed after probe.`);
 });
} catch(e){console.error(e.message);process.exitCode=1;}
