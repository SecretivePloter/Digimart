import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required for migrations');
const pool = new Pool({ connectionString, max: 1 });
try {
  const names = (await readdir(resolve('migrations'))).filter(n => /^\d+.*\.sql$/.test(n)).sort();
  for (const name of names) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(71184952)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [name]);
      if (existing.rowCount) {
        console.log(`Skipped ${name} (already applied)`);
      } else {
        await client.query(await readFile(resolve('migrations', name), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [name]);
        console.log(`Applied ${name}`);
      }
      await client.query('COMMIT');
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
