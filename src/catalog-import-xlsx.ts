import { readFile } from 'node:fs/promises';
import { database } from './services.js';
import { productsFromWorkbook } from './catalog-xlsx.js';
import { catalogForAdmin, saveCatalogProduct } from './catalog-manage.js';
const path=process.argv[2];
if (!path) throw new Error('Isi lokasi file Excel.');
const products=productsFromWorkbook(await readFile(path));
if (!process.argv.includes('--apply')) {
  console.log(`${products.length} produk, ${products.reduce((n,p)=>n+p.variants.length,0)} varian. Draf, stok habis. Kolom biaya, margin, seller tidak diimpor. Tambahkan --apply untuk menyimpan.`);
} else {
  const pool=database(); const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');
    const existing=await catalogForAdmin(client as any);
    for (const p of products) {
      const old=existing.find(x=>x.slug===p.slug);
      if (old) {
        p.id=old.id; p.revision=old.revision;
        p.description=p.description || old.description; p.terms=old.terms;
        for (const v of p.variants) {
          const previous=old.variants.find(x=>x.name.toLowerCase()===v.name.toLowerCase());
          if (previous) Object.assign(v,{id:previous.id,warranty_days:previous.warranty_days,
            warranty_label:previous.warranty_label,requires_email:previous.requires_email});
        }
      }
      // User's previously agreed YouTube warranty, independent of subscription length.
      if (p.slug==='youtube') for (const v of p.variants) {
        v.warranty_days=23; v.warranty_label='1 bulan'; v.requires_email=true;
      }
      await saveCatalogProduct(client,p,'local-import');
    }
    await client.query('COMMIT'); console.log(`Berhasil mengimpor ${products.length} produk sebagai draf.`);
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await pool.end(); }
}
