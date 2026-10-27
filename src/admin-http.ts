import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { passwordMatches } from './admin-auth.js';
import { adminHtml, adminJs } from './admin-ui.js';
import { catalogForAdmin, saveProduct, publicError } from './catalog-manage.js';
const failures=new Map<string,{count:number;until:number}>();
export async function adminHttp(pool: Pool, req: IncomingMessage, res: ServerResponse, path: string) {
  if (path!=='/admin' && !path.startsWith('/admin/')) return false;
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const send=(code:number,body:unknown)=>res.writeHead(code,{'content-type':'application/json'}).end(JSON.stringify(body));
  if (req.method==='GET' && ['/admin','/admin/','/admin/app.js'].includes(path)) {
    res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'}).end(path.endsWith('.js')?adminJs:adminHtml); return true;
  }
  if (path!=='/admin/api/catalog' || !['GET','POST'].includes(req.method??'')) {send(404,{error:'Tidak ditemukan.'});return true;}
  // Remote administration must be configured for an HTTPS origin; localhost works for setup.
  const origin=process.env.ADMIN_PUBLIC_ORIGIN || 'http://localhost:'+ (process.env.PORT||'3000');
  const host=req.headers.host;
  if (!origin.startsWith('https://') && !['localhost:'+ (process.env.PORT||'3000'),'127.0.0.1:'+(process.env.PORT||'3000')].includes(host??'')) {
    send(403,{error:'Konfigurasi HTTPS admin diperlukan.'});return true;
  }
  if (req.headers.origin && req.headers.origin!==origin) {send(403,{error:'Origin tidak diizinkan.'});return true;}
  const ip=req.socket.remoteAddress??'unknown', now=Date.now();
  for(const [key,value] of failures) if(value.until<now) failures.delete(key);
  if ((failures.get(ip)?.count??0)>=10) {send(429,{error:'Terlalu banyak percobaan. Tunggu 5 menit.'});return true;}
  const encoded=req.headers.authorization?.match(/^Basic ([A-Za-z0-9+/=]+)$/)?.[1];
  const decoded=encoded&&encoded.length<1024?Buffer.from(encoded,'base64').toString():'';
  const colon=decoded.indexOf(':'), phone=decoded.slice(0,colon), password=decoded.slice(colon+1);
  const admin=/^[1-9][0-9]{7,14}$/.test(phone)?(await pool.query('SELECT password_hash FROM admins WHERE wa_number=$1 AND active',[phone])).rows[0]:undefined;
  if (!admin?.password_hash || !passwordMatches(password,admin.password_hash)) {
    if (failures.size<1000 || failures.has(ip)) failures.set(ip,{count:(failures.get(ip)?.count??0)+1,until:now+300000});
    send(401,{error:'Nomor admin atau password salah.'});return true;
  }
  failures.delete(ip);
  try {
    if (req.method==='GET') send(200,await catalogForAdmin(pool));
    else {
      if (!req.headers['content-type']?.startsWith('application/json')) {send(415,{error:'JSON diperlukan.'});return true;}
      let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>100000){send(413,{error:'Data terlalu besar.'});return true;}}
      send(200,{id:await saveProduct(pool,JSON.parse(body),phone)});
    }
  } catch(e) { send(400,{error:publicError(e)}); }
  return true;
}
