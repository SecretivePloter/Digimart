import { database } from './services.js';
import { catalogForAdmin } from './catalog-manage.js';
import { catalogCopy, priceChanges } from './catalog-copy.js';

const apply = process.argv.slice(2).includes('--apply');
const pool = database();
try {
  const products = await catalogForAdmin(pool);
  const missing = Object.keys(catalogCopy).filter(slug => !products.some(p => p.slug === slug));
  if (missing.length) throw new Error(`Produk belum ditemukan: ${missing.join(', ')}. Periksa katalog sebelum menerapkan perubahan.`);
  for (const [slug, prices] of Object.entries(priceChanges)) {
    const product = products.find(p => p.slug === slug)!;
    for (const name of Object.keys(prices))
      if (!product.variants.some(v => v.name === name))
        throw new Error(`Varian ${slug}/${name} belum ditemukan. Periksa katalog sebelum menerapkan perubahan.`);
  }
  const changes = products.filter(p => p.slug in catalogCopy).map(p => ({
    slug: p.slug, active: p.active,
    description: catalogCopy[p.slug].map(line => `- ${line}`).join('\n'),
    prices: Object.entries(priceChanges[p.slug] ?? {}).map(([name, price]) => ({ name, price })),
  }));
  console.log(JSON.stringify(changes, null, 2));
  if (!apply) console.log('Pratinjau saja. Jalankan dengan --apply untuk menyimpan.');
  else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const change of changes) {
        const original = products.find(p => p.slug === change.slug)!;
        const updated = await client.query(
          'UPDATE products SET description=$1, terms=$2, revision=revision+1, updated_at=now() WHERE id=$3 AND revision=$4 RETURNING id',
          [change.description, '', original.id, original.revision]);
        if (!updated.rowCount) throw new Error(`Katalog ${change.slug} berubah selama proses. Tidak ada perubahan disimpan.`);
        for (const price of change.prices) {
          const variant = original.variants.find(v => v.name === price.name)!;
          await client.query('UPDATE variants SET base_price_idr=$1, updated_at=now() WHERE product_id=$2 AND id=$3',
            [price.price, original.id, variant.id]);
        }
        await client.query('INSERT INTO catalog_events(product_id,actor,action) VALUES($1,$2,$3)',
          [original.id, 'local-compact-copy', 'update']);
      }
      await client.query('COMMIT');
      console.log(`Keterangan ${changes.length} produk tersimpan.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
} finally { await pool.end(); }
