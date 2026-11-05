import { withDownloadedMedia } from '../dist/downloader.js';
import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [input, mode='/dl'] = process.argv.slice(2);
const cases = input && input !== '--cases' ? [[mode,input,null]] :
  JSON.parse(await readFile(new URL('./downloader-cases.json', import.meta.url), 'utf8'));
for(const [command, url, expected] of cases) {
  const items=[];
  try {
    await withDownloadedMedia(url,url,command,async (path,kind)=>{
      const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path],{encoding:'utf8'})).streams;
      if(kind==='audio') assert.ok(streams.some(s=>s.codec_name==='mp3'));
      else if(kind==='image') assert.ok(streams.some(s=>['png','mjpeg','webp'].includes(s.codec_name)));
      else assert.ok(streams.some(s=>s.codec_type==='video' && !s.disposition?.attached_pic));
      items.push({kind,bytes:(await stat(path)).size});
    });
    if(expected==='carousel') assert.ok(items.length>=2 && items.every(m=>m.kind==='image'));
    else if(expected) assert.ok(items.some(m=>m.kind===expected));
    console.log('PASS',command,url,items);
  } catch(e) {console.error('FAIL',command,url,e.message);process.exitCode=1;}
}
