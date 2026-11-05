import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_BYTES=32*1024*1024;
export const downloaderHelp = 'Kirim satu tautan: .fb LINK, .ig LINK, .x LINK, .yt LINK (video), atau .ytmp3 LINK (audio).';
export function downloadCommand(text: string) {
  const m = text.trim().match(/^(\.fb|\.ig|\.x|\.yt|\.ytmp3|\/(?:dl|download|downloader))(?:\s+([\s\S]*))?$/i);
  return m ? { command: m[1].toLowerCase(), input: (m[2] || '').trim() } : null;
}
export function validateDownloadUrl(input:string, command = '/dl') {
  if(input.length>2048||/\s/.test(input))throw Error('Kirim satu tautan video, tanpa teks tambahan.');
  let u:URL;try{u=new URL(input);}catch{throw Error('Tautan video tidak valid.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Gunakan satu tautan HTTPS resmi dari platform tersebut.');
  const h=u.hostname.toLowerCase(),p=u.pathname;
  let valid=false;
  if(['youtube.com','www.youtube.com','m.youtube.com'].includes(h))valid=(p==='/watch'&&/^[\w-]{11}$/.test(u.searchParams.get('v')??''))||/^\/(shorts|embed)\/[\w-]{11}\/?$/.test(p);
  if(h==='youtu.be')valid=/^\/[\w-]{11}\/?$/.test(p);
  if(['www.instagram.com','instagram.com'].includes(h))valid=/^\/(p|reel|reels|tv)\/[\w-]+\/?$/.test(p);
  if(['www.tiktok.com','tiktok.com','m.tiktok.com'].includes(h))valid=/^\/@[\w.-]+\/video\/\d+\/?$/.test(p)||/^\/t\/[\w-]+\/?$/.test(p);
  if(['vm.tiktok.com','vt.tiktok.com'].includes(h))valid=/^\/[\w-]+\/?$/.test(p);
  if(['www.facebook.com','m.facebook.com','facebook.com'].includes(h)) valid=/^\/share\/(v|p|r)\/[a-zA-Z0-9]+\/?$/.test(p)||/^\/reel\/\d+\/?$/.test(p);
  if(['twitter.com','www.twitter.com','x.com','www.x.com'].includes(h)) valid=/^\/[a-zA-Z0-9_]+\/status\/\d+\/?$/.test(p);
  const family = h.endsWith('instagram.com') ? '.ig' : h.endsWith('facebook.com') ? '.fb' :
    ['twitter.com','www.twitter.com','x.com','www.x.com'].includes(h) ? '.x' :
    h.endsWith('youtube.com') || h === 'youtu.be' ? '.yt' : '.tt';
  if (command.startsWith('.') && family !== (command === '.ytmp3' ? '.yt' : command)) valid=false;
  if(!valid)throw Error('Kirim tautan satu postingan yang sesuai dengan perintah.');
  u.hash='';
  // Only the YouTube video ID is needed; discard tracking/redirect parameters.
  const video=u.searchParams.get('v');u.search='';if(p==='/watch'&&video)u.searchParams.set('v',video);
  return u.toString();
}

export function downloadError(output:string) {
  if(/sign in|login|log in|cookies|private|confirm.*bot|authentication/i.test(output))
    return 'Platform meminta login atau verifikasi akses dari server. Video ini belum bisa diunduh; coba tautan publik lain. Pembayaran dan pesanan tetap berjalan.';
  if(/large|filesize|size limit|timed out|timeout|duration|match filter/i.test(output))
    return 'Unduhan melewati batas waktu, durasi, atau ukuran. Coba video lebih pendek, maksimal 10 menit dan 32 MB.';
  return 'Media belum bisa diambil. Postingan mungkin tidak tersedia atau akses dari server dibatasi.';
}

async function runDownload(url:string,dir:string,command:string) {
  const executable=process.env.DOWNLOADER_PYTHON ?? '/opt/lidealabs/tools/social-venv/bin/python';
  await new Promise<void>((resolvePromise,reject)=>{
    const child=spawn(executable,[resolve('tools/social-media.py'), url, command === '.ytmp3' ? 'mp3' : 'auto'],{cwd:dir,shell:false,windowsHide:true,detached:process.platform!=='win32',
      env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,LANG:'C.UTF-8', HTTPS_PROXY:process.env.DOWNLOADER_HTTPS_PROXY},stdio:['ignore','ignore','pipe']});
    let output='',stopped=false;
    const stop=()=>{if(stopped)return;stopped=true;try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    const timeout=setTimeout(()=>{output+=' timeout';stop();},90000);
    let checking=false;
    const monitor=setInterval(()=>{
      if(checking)return;checking=true;
      void readdir(dir).then(async names=>{
        let total=0;for(const name of names)if(name.startsWith('media-'))total+=(await stat(join(dir,name)).catch(()=>({size:0}))).size;
        if(total>100*1024*1024){output+=' size limit';stop();}
      }).catch(()=>{}).finally(()=>{checking=false;});
    },500);
    const cleanup=()=>{clearTimeout(timeout);clearInterval(monitor);};
    child.stderr.on('data',chunk=>{output=(output+String(chunk)).slice(-8192);});
    child.on('error',()=>{cleanup();reject(Error('Layanan downloader belum tersedia. Hubungi admin.'));});
    child.on('close',code=>{cleanup();if(code===0&&!stopped)resolvePromise();else reject(Error(downloadError(output)));});
  });
}

let active=0;
const recent=new Map<string,number>();
export type MediaKind = 'image'|'video'|'audio';
export async function withDownloadedMedia(phone:string,input:string,command:string,
  send:(path:string,kind:MediaKind)=>Promise<unknown>,runner=runDownload):Promise<void> {
  const url=validateDownloadUrl(input,command),now=Date.now();
  for(const [key,time] of recent)if(now-time>=60000)recent.delete(key);
  if(recent.has(phone))throw Error('Tunggu satu menit sebelum meminta unduhan berikutnya.');
  if(active>=2)throw Error('Dua unduhan sedang diproses. Coba lagi sebentar.');
  recent.set(phone,now);active++;
  let dir='';
  try {
    const base=resolve(process.env.DOWNLOAD_TEMP_DIR??join(tmpdir(),'lidealabs-downloads'));
    await mkdir(base,{recursive:true,mode:0o700});dir=await mkdtemp(join(base,'job-'));
    await runner(url,dir,command);
    const kinds: Record<string, MediaKind> = {jpg:'image',png:'image',webp:'image',mp4:'video',mp3:'audio'};
    const files=(await readdir(dir)).filter(n=>/^media-\d+\.(jpg|png|webp|mp4|mp3)$/.test(n)).sort();
    if(!files.length || files.length > 10) throw Error('Tidak ada media yang dapat dikirim (maksimal 10 item).');
    const batch = [];
    let total=0;
    for (const name of files) {
      const path=join(dir,name), info=await stat(path);
      total+=info.size;
      if(!info.isFile() || !info.size || info.size>MAX_BYTES || total>100*1024*1024)
        throw Error('Media melebihi batas ukuran unduhan.');
      const kind=kinds[name.split('.').pop()!];
      if(command === '.ytmp3' && kind !== 'audio') throw Error('Konversi MP3 belum berhasil.');
      batch.push({path,kind});
    }
    for(const item of batch) await send(item.path,item.kind);
  } finally {
    active--;if(dir)await rm(dir,{recursive:true,force:true});
  }
}
