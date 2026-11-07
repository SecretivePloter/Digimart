import {Pool} from 'pg';
import {lookup} from 'node:dns/promises';
for (const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED']) {
  if(!process.env[key]) {console.log(JSON.stringify({key,configured:false}));continue;}
  const url=new URL(process.env[key]);
  const start=Date.now();
  try {
    const addresses=await lookup(url.hostname,{all:true});
    console.log(JSON.stringify({key,dns:true,families:addresses.map(a=>a.family)}));
  } catch {console.log(JSON.stringify({key,dns:false}));}
  const pool=new Pool({connectionString:process.env[key],max:1,connectionTimeoutMillis:15000,query_timeout:15000});
  pool.on('error',()=>{});
  try {await pool.query('SELECT 1');console.log(JSON.stringify({key,connected:true,ms:Date.now()-start}));}
  catch(e) {console.log(JSON.stringify({key,connected:false,code:e.code ?? e.name,ms:Date.now()-start}));process.exitCode=1;}
  finally {await pool.end();}
}
