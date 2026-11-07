import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { Pool } from 'pg';
import { activeAdmin } from './catalog-manage.js';

type Message = { role: 'user' | 'assistant'; content: string };
type Generate = (messages: Message[]) => Promise<string>;
const queues = new Map<string, Promise<void>>();

export function aiCommand(text: string) {
  const match = /^\/ai(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? (match[1]?.trim() ?? '') : null;
}

async function generate(messages: Message[]) {
  const { text } = await generateText({
    model: openai(process.env.OPENAI_MODEL || 'gpt-6-luna'),
    system: [
      'Kamu asisten pribadi admin LIDEALABS melalui WhatsApp.',
      'Balas dalam bahasa Indonesia dengan jelas dan ringkas kecuali diminta bahasa lain.',
      'Kamu terhubung melalui OpenAI API. Ini bukan sesi ChatGPT pengguna dan kamu tidak memiliki akses otomatis ke riwayat ChatGPT, Library, repositori, database, atau informasi terbaru.',
      'Jangan mengaku telah mengubah data, menjalankan perintah, atau memeriksa stok/harga jika tidak diberi data dalam percakapan.',
    ].join(' '),
    messages,
    maxOutputTokens: 700,
    timeout: 30_000,
  });
  return text.trim();
}

async function run(pool: Pool, phone: string, command: string, reply: Generate) {
  if (command.toLowerCase() === 'reset') {
    await pool.query('DELETE FROM admin_ai_chats WHERE phone=$1', [phone]);
    return 'Riwayat percakapan AI di WhatsApp telah dihapus.';
  }
  if (!command) return 'Ketik */ai pertanyaanmu* untuk bertanya, atau */ai reset* untuk menghapus riwayat.';
  if (command.length > 2000) return 'Pertanyaan terlalu panjang. Batasi hingga 2.000 karakter.';
  if (!process.env.OPENAI_API_KEY) return 'AI belum diaktifkan. Isi OPENAI_API_KEY pada .env.local lalu mulai ulang bot.';

  const row = await pool.query<{ messages: unknown }>('SELECT messages FROM admin_ai_chats WHERE phone=$1', [phone]);
  const stored = row.rows[0]?.messages;
  const history: Message[] = Array.isArray(stored) ? stored.filter((m): m is Message =>
    !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12) : [];
  const messages = [...history, { role: 'user' as const, content: command }];
  const answer = await reply(messages);
  if (!answer) return 'AI tidak memberikan jawaban. Coba pertanyaan lain.';
  await pool.query(
    `INSERT INTO admin_ai_chats(phone,messages) VALUES($1,$2::jsonb)
     ON CONFLICT(phone) DO UPDATE SET messages=EXCLUDED.messages,updated_at=now()`,
    [phone, JSON.stringify([...messages, { role: 'assistant', content: answer }].slice(-12))]);
  return answer.length > 3500 ? answer.slice(0, 3497) + '...' : answer;
}

export async function adminAiMessage(pool: Pool, phone: string, text: string, reply: Generate = generate): Promise<string | null> {
  const command = aiCommand(text);
  if (command === null) return null;
  if (!await activeAdmin(pool, phone)) return 'Akses AI hanya tersedia untuk admin terdaftar.';

  // Keep requests from the same admin in order, including resets.
  const previous = queues.get(phone) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(() => run(pool, phone, command, reply));
  const done = result.then(() => {}, () => {});
  queues.set(phone, done);
  void done.then(() => { if (queues.get(phone) === done) queues.delete(phone); });
  try { return await result; }
  catch (error) {
    console.error('Permintaan AI admin gagal:', error);
    return 'AI sedang tidak tersedia. Coba lagi nanti atau periksa konfigurasi API.';
  }
}
