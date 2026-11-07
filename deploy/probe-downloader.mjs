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
      else {
        assert.ok(streams.some(s=>s.codec_type==='video' && s.codec_name==='h264' && s.pix_fmt==='yuv420p'));
        assert.ok(streams.filter(s=>s.codec_type==='audio').every(s=>s.codec_name==='aac'));
        execFileSync('ffmpeg',['-nostdin','-v','error','-xerror','-i',path,'-map','0:v:0','-map','0:a:0?','-f','null','-'],{timeout:30000});
      }
      const format=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',path],{encoding:'utf8'})).format;
      items.push({kind,bytes:(await stat(path)).size,duration:format.duration,codecs:streams.map(s=>s.codec_name)});
    });
    if(expected==='carousel') assert.ok(items.length>=2 && items.every(m=>m.kind==='image'));
    else if(expected) assert.ok(items.some(m=>m.kind===expected));
    console.log('PASS',command,url,items);
  } catch(e) {console.error('FAIL',command,url,e.message);process.exitCode=1;}
}
