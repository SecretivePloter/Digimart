import type { Pool } from 'pg';

type Variant = {
  id: string;
  name: string;
  base_price_idr: string;
  stock_status: 'ready' | 'limited' | 'out';
  warranty_label: string;
  requires_email: boolean;
};

export async function listCatalog(pool: Pool) {
  const result = await pool.query<{
    catalog_number: number; slug: string; name: string; stock_status: string;
  }>(`
    SELECT p.catalog_number, p.slug, p.name,
      CASE
        WHEN count(v.id) FILTER (WHERE v.stock_status = 'ready') > 0 THEN 'ready'
        WHEN count(v.id) FILTER (WHERE v.stock_status = 'limited') > 0 THEN 'limited'
        ELSE 'out'
      END AS stock_status
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id AND v.active
    WHERE p.active
    GROUP BY p.id
    ORDER BY p.catalog_number
  `);
  return result.rows;
}

export async function productDetail(pool: Pool, selector: string) {
  const byNumber = /^\d+$/.test(selector);
  const result = await pool.query<{
    catalog_number: number; slug: string; name: string;
    description: string; terms: string; variants: Variant[];
  }>(`
    SELECT p.catalog_number, p.slug, p.name, p.description, p.terms,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'base_price_idr', v.base_price_idr,
        'stock_status', v.stock_status, 'warranty_label', v.warranty_label,
        'requires_email', v.requires_email
      ) ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS variants
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id AND v.active
    WHERE p.active AND ${byNumber ? 'p.catalog_number = $1::integer' : 'p.slug = $1'}
    GROUP BY p.id
  `, [selector]);
  return result.rows[0] ?? null;
}
