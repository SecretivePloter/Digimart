import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadCommand,validateDownloadUrl,downloadError,withDownloadedMedia } from './downloader.js';

test('downloader accepts only single-video platform URLs and strips tracking parameters',()=>{
  for(const url of ['https://youtu.be/jNQXAC9IVRw','https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://www.instagram.com/reel/abc_123/','https://www.tiktok.com/@example/video/123456789','https://vt.tiktok.com/abc123/'])assert.ok(validateDownloadUrl(url));
  for(const url of ['http://127.0.0.1/x','https://localhost/x','file:///etc/passwd','https://youtube.com.evil.test/watch?v=jNQXAC9IVRw',
    'https://evil@youtube.com/watch?v=jNQXAC9IVRw','https://youtube.com:444/watch?v=jNQXAC9IVRw',
    'https://youtube.com/playlist?list=abc','https://instagram.com/example','https://tiktok.com/@example/live','--exec rm',
    'https://youtu.be/jNQXAC9IVRw ; whoami'])assert.throws(()=>validateDownloadUrl(url));
  assert.equal(validateDownloadUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=abc&url=http://127.0.0.1'),'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(downloadCommand('/dl https://youtu.be/jNQXAC9IVRw')?.input,'https://youtu.be/jNQXAC9IVRw');
  assert.equal(downloadCommand('/downloader')?.input,'');assert.equal(downloadCommand('konfirmasi beli'),null);
  assert.match(downloadError('Sign in to confirm you are not a bot'),/meminta login/);
});

test('downloader cleans temporary files on delivery success/failure and limits repeated requests',async()=>{
  let path='';
  await withDownloadedMedia('test-1','https://youtu.be/jNQXAC9IVRw','/dl',async p=>{path=p;assert.equal((await stat(p)).size,7);},
    async(_url,dir)=>{await writeFile(join(dir,'media-01.mp4'),'fixture');});
  await assert.rejects(stat(path));
  await assert.rejects(withDownloadedMedia('test-1','https://youtu.be/jNQXAC9IVRw','/dl',async()=>{}),/satu menit/);
  await assert.rejects(withDownloadedMedia('test-2','https://youtu.be/jNQXAC9IVRw','/dl',async()=>{throw Error('Delivery unavailable');},
    async(_url,dir)=>{path=join(dir,'media-01.mp4');await writeFile(path,'fixture');}),/Delivery/);
  await assert.rejects(stat(path));
});

test('album delivery keeps post order and MP3 commands only accept YouTube', async()=>{
  const req=downloadCommand('.ig https://www.instagram.com/p/DfJwl5CE1cJ/?img_index=3')!;
  const sent:string[]=[];
  await withDownloadedMedia('album',req.input,req.command,async(path, kind)=>{sent.push(kind);},async(url,dir)=>{
    assert.equal(url,'https://www.instagram.com/p/DfJwl5CE1cJ/');
    await writeFile(join(dir,'media-02.mp4'),'clip');
    await writeFile(join(dir,'media-01.jpg'),'photo');
  });
  assert.deepEqual(sent,['image','video']);
  assert.throws(()=>validateDownloadUrl(req.input,'.ytmp3'));
  assert.throws(()=>validateDownloadUrl('https://x.com.evil.test/a/status/1','.x'));
});
