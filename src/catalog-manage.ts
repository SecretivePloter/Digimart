import type { Pool, PoolClient } from 'pg';

export type CatalogProduct = {
  id?: string; revision?: number; slug: string; name: string;
  description: string; terms: string; active: boolean;
  variants: { id?: string; name: string; base_price_idr: number; stock_status: string;
    warranty_days: number; warranty_label: string; requires_email: boolean; active: boolean }[];
};
export function validateProduct(value: unknown): asserts value is CatalogProduct {
  const p = value as CatalogProduct;
  const str = (x: unknown, max: number) => typeof x === 'string' && x.length <= max;
  if (!p || !str(p.slug, 100) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) ||
      !str(p.name, 200) || !p.name.trim() || !str(p.description, 6000) || !str(p.terms, 6000) ||
      typeof p.active !== 'boolean' || !Array.isArray(p.variants) || p.variants.length > 100 ||
      (p.id !== undefined && !/^\d+$/.test(p.id)) ||
      (p.revision !== undefined && (!Number.isSafeInteger(p.revision) || p.revision < 1)))
    throw new Error('Data produk tidak valid.');
  const names = new Set<string>(); const ids = new Set<string>();
  for (const v of p.variants) {
    if (!v || !str(v.name, 200) || !v.name.trim() || names.has(v.name.trim().toLowerCase()) ||
        !Number.isSafeInteger(v.base_price_idr) || v.base_price_idr <= 0 ||
        !['ready','limited','out'].includes(v.stock_status) ||
        !Number.isSafeInteger(v.warranty_days) || v.warranty_days < 0 ||
        !str(v.warranty_label, 100) || typeof v.active !== 'boolean' || typeof v.requires_email !== 'boolean' ||
        (v.id !== undefined && (!/^\d+$/.test(v.id) || ids.has(v.id))))
      throw new Error('Data varian tidak valid atau duplikat.');
    names.add(v.name.trim().toLowerCase()); if (v.id) ids.add(v.id);
  }
  if (p.active && (!p.description.trim() || !p.variants.some(v=>v.active)))
    throw new Error('Lengkapi deskripsi dan aktifkan minimal satu varian sebelum publikasi.');
}
export async function catalogForAdmin(pool: Pool) {
  const result = await pool.query(`SELECT p.id::text, p.catalog_number, p.slug, p.name, p.description,
    p.terms, p.active, p.revision, COALESCE(jsonb_agg(jsonb_build_object(
      'id',v.id::text,'name',v.name,'base_price_idr',v.base_price_idr,'stock_status',v.stock_status,
      'warranty_days',v.warranty_days,'warranty_label',v.warranty_label,
      'requires_email',v.requires_email,'active',v.active) ORDER BY v.id)
      FILTER (WHERE v.id IS NOT NULL),'[]'::jsonb) AS variants
    FROM products p LEFT JOIN variants v ON v.product_id=p.id GROUP BY p.id ORDER BY p.catalog_number`);
  return result.rows as (CatalogProduct & { id: string; catalog_number: number; revision: number })[];
}
export async function saveCatalogProduct(client: PoolClient, p: CatalogProduct, actor: string) {
  validateProduct(p);
  // Serializes catalog-number allocation and changes from WhatsApp, web and imports.
  await client.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');
  let id: string;
  if (p.id) {
    if (!p.revision) throw new Error('Versi produk diperlukan. Muat ulang produk.');
    const result = await client.query(`UPDATE products SET name=$2, description=$3, terms=$4,
      active=$5, revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$6 RETURNING id::text`,
    [p.id,p.name.trim(),p.description,p.terms,p.active,p.revision]);
    if (!result.rowCount) throw new Error('Produk telah diubah admin lain. Muat ulang sebelum menyimpan.');
    id = result.rows[0].id;
  } else {
    const result = await client.query(`INSERT INTO products(catalog_number,slug,name,description,terms,active)
      SELECT COALESCE(MAX(catalog_number),0)+1,$1,$2,$3,$4,$5 FROM products RETURNING id::text`,
    [p.slug,p.name.trim(),p.description,p.terms,p.active]);
    id = result.rows[0].id;
  }
  const kept: string[] = [];
  for (const v of p.variants) {
    const values = [id,v.name.trim(),v.base_price_idr,v.stock_status,v.warranty_days,v.warranty_label,v.requires_email,v.active];
    const result = v.id
      ? await client.query(`UPDATE variants SET name=$2,base_price_idr=$3,stock_status=$4,warranty_days=$5,
          warranty_label=$6,requires_email=$7,active=$8,updated_at=now() WHERE product_id=$1 AND id=$9 RETURNING id::text`,[...values,v.id])
      : await client.query(`INSERT INTO variants(product_id,name,base_price_idr,stock_status,warranty_days,warranty_label,requires_email,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`, values);
    if (!result.rowCount) throw new Error('Varian bukan milik produk ini.');
    kept.push(result.rows[0].id);
  }
  await client.query('UPDATE variants SET active=false,updated_at=now() WHERE product_id=$1 AND NOT(id=ANY($2::bigint[]))',[id,kept]);
  await client.query('INSERT INTO catalog_events(product_id,actor,action) VALUES($1,$2,$3)',[id,actor,p.id?'update':'create']);
  return id;
}
export async function saveProduct(pool: Pool, product: CatalogProduct, actor: string) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const id=await saveCatalogProduct(client,product,actor);
    await client.query('COMMIT'); return id;
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function activeAdmin(pool: Pool, phone: string) {
  if (!/^[1-9][0-9]{7,14}$/.test(phone)) return false;
  return !!(await pool.query('SELECT id FROM admins WHERE wa_number=$1 AND active',[phone])).rowCount;
}
export function publicError(e: unknown) {
  return e instanceof Error && !('code' in e) ? e.message : 'Penyimpanan gagal. Periksa slug atau nama varian yang duplikat.';
}
