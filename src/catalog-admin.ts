import { readFile } from 'node:fs/promises';
import { database } from './services.js';
import { catalogForAdmin, saveProduct, validateProduct } from './catalog-manage.js';
const [operation,file]=process.argv.slice(2);
if (!['inspect','import'].includes(operation??'')) throw new Error('Gunakan catalog:inspect atau catalog:import -- file.json');
const pool=database();
try {
  const rows=await catalogForAdmin(pool);
  if (operation==='inspect') console.log(JSON.stringify(rows,null,2));
  else {
    if (!file) throw new Error('Isi lokasi JSON.');
    const p=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
    validateProduct(p);
    const old=rows.find(x=>x.slug===p.slug);
    if (old) {
      p.id=old.id;p.revision=old.revision;
      for(const v of p.variants) {
        const previous=old.variants.find(x=>x.name.toLowerCase()===v.name.toLowerCase());
        if(previous) v.id=previous.id;
      }
    }
    await saveProduct(pool,p,'local-json-import');
    console.log('Produk berhasil diimpor.');
  }
} finally { await pool.end(); }
