import { readFile } from 'node:fs/promises';
import { database } from './services.js';

type VariantInput = {
  name: string;
  base_price_idr: number;
  stock_status: 'ready' | 'limited' | 'out';
  warranty_days: number;
  warranty_label: string;
  requires_email: boolean;
  active: boolean;
};
type ProductInput = {
  catalog_number: number;
  slug: string;
  name: string;
  description: string;
  terms: string;
  active: boolean;
  variants: VariantInput[];
};

function validate(value: unknown): asserts value is ProductInput {
  if (!value || typeof value !== 'object') throw new Error('Product must be an object');
  const p = value as Partial<ProductInput>;
  if (!Number.isSafeInteger(p.catalog_number) || (p.catalog_number ?? 0) <= 0 ||
      typeof p.slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) ||
      typeof p.name !== 'string' || !p.name.trim() ||
      typeof p.description !== 'string' || typeof p.terms !== 'string' ||
      typeof p.active !== 'boolean' || !Array.isArray(p.variants) || !p.variants.length) {
    throw new Error('Invalid product fields');
  }
  const names = new Set<string>();
  for (const v of p.variants) {
    if (!v || typeof v.name !== 'string' || !v.name.trim() || names.has(v.name) ||
        !Number.isSafeInteger(v.base_price_idr) || v.base_price_idr <= 0 ||
        !['ready', 'limited', 'out'].includes(v.stock_status) ||
        !Number.isSafeInteger(v.warranty_days) || v.warranty_days < 0 ||
        typeof v.warranty_label !== 'string' ||
        typeof v.requires_email !== 'boolean' || typeof v.active !== 'boolean') {
      throw new Error('Invalid or duplicate variant');
    }
    names.add(v.name);
    if (p.active && v.active && (!p.terms.trim() || v.warranty_days === 0 || !v.warranty_label.trim())) {
      throw new Error('Active variants require final terms and a positive warranty duration');
    }
  }
}

const [operation, file] = process.argv.slice(2);
if (!['import', 'inspect'].includes(operation ?? '')) {
  throw new Error('Usage: npm run catalog:import -- catalog/product.json OR npm run catalog:inspect');
}
if (operation === 'import' && !file) throw new Error('Provide a product JSON file');

const pool = database();
try {
  if (operation === 'inspect') {
    const result = await pool.query(`
      SELECT p.catalog_number, p.slug, p.name, p.active,
        COALESCE(jsonb_agg(jsonb_build_object(
          'name', v.name, 'base_price_idr', v.base_price_idr,
          'stock_status', v.stock_status, 'warranty_days', v.warranty_days,
          'warranty_label', v.warranty_label,
          'active', v.active
        ) ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS variants
      FROM products p LEFT JOIN variants v ON v.product_id = p.id
      GROUP BY p.id ORDER BY p.catalog_number
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    const product: unknown = JSON.parse(await readFile(file!, 'utf8'));
    validate(product);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saved = await client.query<{ id: string }>(`
        INSERT INTO products (catalog_number, slug, name, description, terms, active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (slug) DO UPDATE SET
          catalog_number = EXCLUDED.catalog_number, name = EXCLUDED.name,
          description = EXCLUDED.description, terms = EXCLUDED.terms,
          active = EXCLUDED.active, updated_at = now()
        RETURNING id
      `, [product.catalog_number, product.slug, product.name, product.description, product.terms, product.active]);
      for (const variant of product.variants) {
        await client.query(`
          INSERT INTO variants (product_id, name, base_price_idr, stock_status, warranty_days, warranty_label, requires_email, active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (product_id, name) DO UPDATE SET
            base_price_idr = EXCLUDED.base_price_idr, stock_status = EXCLUDED.stock_status,
            warranty_days = EXCLUDED.warranty_days, warranty_label = EXCLUDED.warranty_label,
            requires_email = EXCLUDED.requires_email,
            active = EXCLUDED.active, updated_at = now()
        `, [saved.rows[0].id, variant.name, variant.base_price_idr,
          variant.stock_status, variant.warranty_days, variant.warranty_label,
          variant.requires_email, variant.active]);
      }
      await client.query(
        'UPDATE variants SET active = false, updated_at = now() WHERE product_id = $1 AND NOT (name = ANY($2::text[]))',
        [saved.rows[0].id, product.variants.map(v => v.name)]
      );
      await client.query('COMMIT');
      console.log(`Imported ${product.slug} (${product.variants.length} variants, active=${product.active})`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
