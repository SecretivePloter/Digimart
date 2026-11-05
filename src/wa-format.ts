import { catalogCopy } from './catalog-copy.js';

export function formatCatalog(rows: Array<{ catalog_number: number; name: string; stock_status: string }>) {
  if (!rows.length) return 'Katalog Digimart belum tersedia. Silakan hubungi admin.';
  const icon: Record<string, string> = { ready: '🟢', limited: '🟡', out: '🔴' };
  return ['*🛒 KATALOG DIGIMART*', ...rows.map(row =>
    `${String(row.catalog_number).padStart(2, '0')}. ${row.name} ${icon[row.stock_status] ?? '🔴'}`
  ), '', 'Ketik nama produk atau nomornya untuk melihat detail.'].join('\n');
}

export function formatProduct(product: {
  slug: string; name: string;
  variants: Array<{ name: string; base_price_idr: string; stock_status: string; warranty_label: string }>;
}) {
  const icon: Record<string, string> = { ready: '🟢', limited: '🟡', out: '🔴' };
  const notes = Object.hasOwn(catalogCopy, product.slug) ? catalogCopy[product.slug] : [];
  return [`*${product.name.toUpperCase()}*`, '', '*Pilihan varian:*',
    ...product.variants.map((v, i) =>
      `${i + 1}. ${v.name} — Rp${Number(v.base_price_idr).toLocaleString('id-ID')} ${icon[v.stock_status] ?? '🔴'}`
    ),
    ...(notes.length ? ['', '*Keterangan:*', ...notes.map(note => '- ' + note)] : []),
    '', 'Balas angka pilihan, contoh: 1.'].join('\n');
}
