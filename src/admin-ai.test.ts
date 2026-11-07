import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Pool } from 'pg';
import { adminAiMessage } from './admin-ai.js';

test('AI is admin-only, retains context, and reset clears it without calling the model', async () => {
  let stored: unknown = null;
  const pool = { async query(sql: string, params: unknown[]) {
    if (sql.includes('FROM admins')) return { rowCount: params[0] === '6281234567890' ? 1 : 0, rows: [] };
    if (sql.startsWith('SELECT messages')) return { rows: stored ? [{ messages: stored }] : [] };
    if (sql.startsWith('INSERT INTO admin_ai_chats')) { stored = JSON.parse(params[1] as string); return { rows: [] }; }
    if (sql.startsWith('DELETE FROM admin_ai_chats')) { stored = null; return { rows: [] }; }
    throw new Error('Unexpected query');
  } } as unknown as Pool;
  const seen: unknown[] = [];
  const reply = async (messages: unknown) => { seen.push(messages); return 'Jawaban'; };
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  try {
    assert.equal(await adminAiMessage(pool, '6280000000000', '/ai rahasia', reply), 'Akses AI hanya tersedia untuk admin terdaftar.');
    assert.equal(await adminAiMessage(pool, '6281234567890', 'list', reply), null);
    assert.equal(await adminAiMessage(pool, '6281234567890', '/ai halo', reply), 'Jawaban');
    assert.equal(await adminAiMessage(pool, '6281234567890', '/ai lanjut', reply), 'Jawaban');
    assert.equal((seen[1] as unknown[]).length, 3);
    assert.match(await adminAiMessage(pool, '6281234567890', '/ai reset', reply) ?? '', /dihapus/);
    assert.equal(await adminAiMessage(pool, '6281234567890', '/ai baru', reply), 'Jawaban');
    assert.equal((seen[2] as unknown[]).length, 1);
    assert.equal(seen.length, 3);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
