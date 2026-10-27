import { randomBytes } from 'node:crypto';
import { database } from './services.js';
import { passwordHash } from './admin-auth.js';
const phones=process.argv.slice(2);
if (!phones.length || phones.some(p=>!/^62[0-9]{8,13}$/.test(p))) throw new Error('Isi nomor admin dengan format 628…');
const pool=database();
try {
  for (const [i,phone] of phones.entries()) {
    const password=randomBytes(18).toString('base64url');
    const result=await pool.query(`INSERT INTO admins(wa_number,name,password_hash) VALUES($1,$2,$3)
      ON CONFLICT(wa_number) DO UPDATE SET password_hash=EXCLUDED.password_hash
      WHERE admins.password_hash IS NULL AND admins.active RETURNING id`,[phone,`Admin ${i+1}`,passwordHash(password)]);
    if (result.rowCount) console.log(`Login dashboard: ${phone}\nPassword: ${password}\nSimpan password ini secara privat.\n`);
    else console.log('Admin sudah memiliki password atau telah dinonaktifkan; tidak diubah.');
  }
} finally { await pool.end(); }
