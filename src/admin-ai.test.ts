import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Pool } from 'pg';
import { adminAiMessage } from './admin-ai.js';

test('admin mode toggles, preserves context, accepts media, and expires after two hours', async () => {
  let stored: unknown = null;
  let mode = false;
  let expired = false;
  const pool = { async query(sql: string, params: unknown[]) {
    if (sql.startsWith('SELECT last_activity')) return { rowCount: mode && !expired ? 1 : 0, rows: mode && !expired ? [{ last_activity: new Date() }] : [] };
    if (sql.includes('FROM admins')) return { rowCount: params[0] === '6281234567890' ? 1 : 0, rows: [] };
    if (sql.startsWith('INSERT INTO admin_ai_mode')) { mode = true; expired = false; return { rows: [] }; }
    if (sql.startsWith('UPDATE admin_ai_mode')) return { rows: [] };
    if (sql.startsWith('DELETE FROM admin_ai_mode')) { mode = false; return { rows: [] }; }
    if (sql.startsWith('SELECT messages')) return { rows: stored ? [{ messages: stored }] : [] };
    if (sql.startsWith('INSERT INTO admin_ai_chats')) { stored = JSON.parse(params[1] as string); return { rows: [] }; }
    if (sql.startsWith('DELETE FROM admin_ai_chats')) { stored = null; return { rows: [] }; }
    throw new Error('Unexpected query: ' + sql);
  } } as unknown as Pool;
  const seen: unknown[][] = [];
  const reply = async (messages: unknown[]) => { seen.push(messages); return 'Jawaban'; };
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  try {
    assert.equal(await adminAiMessage(pool, '6280000000000', '.ai'), 'Akses AI hanya tersedia untuk admin terdaftar.');
    assert.equal(await adminAiMessage(pool, '6281234567890', 'list'), null);
    assert.match(await adminAiMessage(pool, '6281234567890', '.ai') ?? '', /aktif/);
    assert.equal(await adminAiMessage(pool, '6281234567890', 'halo', undefined, reply), 'Jawaban');
    let downloaded = 0;
    assert.equal(await adminAiMessage(pool, '6281234567890', 'foto apa ini', async () => {
      downloaded++; return { data: Buffer.from('fake-image'), mediaType: 'image/png' };
    }, reply), 'Jawaban');
    assert.equal(downloaded, 1);
    assert.equal(seen[1].length, 3);
    assert.match(await adminAiMessage(pool, '6281234567890', '.ai reset') ?? '', /dihapus/);
    assert.equal(await adminAiMessage(pool, '6281234567890', 'lanjut', undefined, reply), 'Jawaban');
    assert.equal(seen[2].length, 1);
    assert.match(await adminAiMessage(pool, '6281234567890', '.ai') ?? '', /nonaktif/);
    assert.equal(await adminAiMessage(pool, '6281234567890', 'list', async () => {
      downloaded++; return { data: Buffer.from('x'), mediaType: 'image/png' };
    }, reply), null);
    assert.equal(downloaded, 1);
    assert.match(await adminAiMessage(pool, '6281234567890', '.ai') ?? '', /aktif/);
    expired = true;
    assert.equal(await adminAiMessage(pool, '6281234567890', 'sesudah dua jam', undefined, reply), null);
    assert.equal(seen.length, 3);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
