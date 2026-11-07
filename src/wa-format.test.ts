import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatCatalog, formatProduct } from './wa-format.js';
import { catalogCopy, priceChanges } from './catalog-copy.js';

test('catalog and variant messages show prices and stock without internal warranty duration', () => {
  const list = formatCatalog([{ catalog_number: 1, name: 'YOUTUBE', stock_status: 'ready' }]);
  assert.match(list, /01\. YOUTUBE 🟢/);
  const detail = formatProduct({
    name: 'YOUTUBE', slug: 'youtube',
    variants: [{ name: 'Invite 1 Bulan', base_price_idr: '12000', stock_status: 'limited', warranty_label: '1 bulan' }],
  });
  assert.match(detail, /Rp12\.000 🟡/);
  assert.match(detail, /Gmail pembeli/);
});

test('product reply keeps one compact section and current variant prices', () => {
  const detail = formatProduct({
    name: 'YouTube', slug: 'youtube',
    variants: [
      { name: '1 Bulan via Invite', base_price_idr: '9000', stock_status: 'ready', warranty_label: '' },
      { name: 'Family head gmail buyer', base_price_idr: String(priceChanges.youtube['Family head gmail buyer']), stock_status: 'ready', warranty_label: '' },
    ],
  });
  assert.match(detail, /1 Bulan via Invite — Rp9\.000/);
  assert.match(detail, /Family head gmail buyer — Rp19\.000/);
  assert.equal((detail.match(/\*Keterangan:\*/g) ?? []).length, 1);
  assert.doesNotMatch(detail, /YANG KAMU DAPAT|Klik Beli/);
});

test('all catalog entries use prepared display copy even with full marketing text in the database', () => {
  for (const slug of [...Object.keys(catalogCopy), 'produk-baru']) {
    const product = { slug, name: slug, description: 'YANG KAMU DAPAT', terms: 'Klik Beli Sekarang', variants: [] };
    const reply = formatProduct(product);
    for (const note of catalogCopy[slug] ?? []) assert.ok(reply.includes(note));
    assert.doesNotMatch(reply, /YANG KAMU DAPAT|Klik Beli Sekarang/);
    assert.ok(reply.endsWith('Balas angka pilihan, contoh: 1.'));
  }
});
