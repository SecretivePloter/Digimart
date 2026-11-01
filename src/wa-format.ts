export function formatCatalog(rows: Array<{ catalog_number: number; name: string; stock_status: string }>) {
  if (!rows.length) return 'Katalog Digimart belum tersedia. Silakan hubungi admin.';
  const icon: Record<string, string> = { ready: '🟢', limited: '🟡', out: '🔴' };
  return ['*🛒 KATALOG DIGIMART*', ...rows.map(row =>
    `${String(row.catalog_number).padStart(2, '0')}. ${row.name} ${icon[row.stock_status] ?? '🔴'}`
  ), '', 'Ketik nama produk atau nomornya untuk melihat detail.'].join('\n');
}

export function formatProduct(product: {
  name: string; description: string; terms: string;
  variants: Array<{ name: string; base_price_idr: string; stock_status: string; warranty_label: string }>;
}) {
  const icon: Record<string, string> = { ready: '🟢', limited: '🟡', out: '🔴' };
  return [`*${product.name.toUpperCase()}*`, '', '*Pilihan varian:*',
    ...product.variants.map((v, i) =>
      `${i + 1}. ${v.name} — Rp${Number(v.base_price_idr).toLocaleString('id-ID')} ${icon[v.stock_status] ?? '🔴'}`
    ),
    '', ...(product.description.trim() ? ['*Keterangan:*', product.description.trim()] : []),
    ...(product.terms.trim() ? ['', product.terms.trim()] : []), '',
    'Balas nomor varian yang Anda pilih.'].filter(Boolean).join('\n');
}
