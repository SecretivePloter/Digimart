import { generateText, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { Pool } from 'pg';
import { activeAdmin } from './catalog-manage.js';

type Message = { role: 'user' | 'assistant'; content: string };
export type AiAttachment = { data: Buffer; mediaType: string; filename?: string };
export type AttachmentLoader = () => Promise<AiAttachment>;
type Generate = (messages: ModelMessage[]) => Promise<string>;
const queues = new Map<string, Promise<void>>();

async function generate(messages: ModelMessage[]) {
  const { text } = await generateText({
    model: openai(process.env.OPENAI_MODEL || 'gpt-6-luna'),
    system: [
      'Kamu asisten pribadi admin LIDEALABS melalui WhatsApp.',
      'Balas dalam bahasa Indonesia dengan jelas dan ringkas kecuali diminta bahasa lain.',
      'Kamu terhubung melalui OpenAI API, bukan sesi ChatGPT pengguna. Kamu tidak memiliki akses otomatis ke riwayat ChatGPT, Library, repositori, database, atau informasi terbaru.',
      'Jangan mengaku telah mengubah data, menjalankan perintah, atau memeriksa stok/harga jika tidak diberi data dalam percakapan.',
    ].join(' '),
    messages,
    maxOutputTokens: 700,
    timeout: 30_000,
  });
  return text.trim();
}

function requestMessage(text: string, attachment?: AiAttachment): ModelMessage {
  if (!attachment) return { role: 'user', content: text };
  if (attachment.mediaType === 'text/plain')
    return { role: 'user', content: `${text || 'Jelaskan isi dokumen ini.'}\n\nIsi ${attachment.filename ?? 'dokumen'}:\n${attachment.data.toString('utf8')}` };
  return { role: 'user', content: [
    { type: 'text', text: text || 'Jelaskan isi lampiran ini.' },
    { type: 'file', data: attachment.data, mediaType: attachment.mediaType, filename: attachment.filename },
  ] };
}

async function run(pool: Pool, phone: string, text: string, loadAttachment: AttachmentLoader | undefined, reply: Generate) {
  const toggle = text.trim().toLowerCase() === '.ai';
  const reset = text.trim().toLowerCase() === '.ai reset';
  const mode = await pool.query<{ last_activity: Date }>(
    "SELECT last_activity FROM admin_ai_mode WHERE phone=$1 AND last_activity > now() - interval '2 hours'", [phone]);
  const enabled = !!mode.rowCount;
  if (!enabled && !toggle) return null;
  if (!await activeAdmin(pool, phone)) return 'Akses AI hanya tersedia untuk admin terdaftar.';
  if (toggle) {
    if (enabled) {
      await pool.query('DELETE FROM admin_ai_mode WHERE phone=$1', [phone]);
      return 'Mode AI nonaktif. Pesan berikutnya kembali ke bot Digimart.';
    }
    if (!process.env.OPENAI_API_KEY) return 'AI belum diaktifkan. Isi OPENAI_API_KEY pada .env.local lalu mulai ulang bot.';
    await pool.query(`INSERT INTO admin_ai_mode(phone,last_activity) VALUES($1,now())
      ON CONFLICT(phone) DO UPDATE SET last_activity=now()`, [phone]);
    return 'Mode AI aktif. Kirim pesan, gambar, atau dokumen. Ketik .ai lagi untuk keluar. Mode berakhir otomatis setelah 2 jam tanpa pesan.';
  }
  // Every incoming message in AI mode counts as activity, including invalid attachments.
  await pool.query('UPDATE admin_ai_mode SET last_activity=now() WHERE phone=$1', [phone]);
  if (reset) {
    await pool.query('DELETE FROM admin_ai_chats WHERE phone=$1', [phone]);
    return 'Riwayat percakapan AI di WhatsApp telah dihapus. Mode AI tetap aktif.';
  }
  if (text.length > 2000) return 'Pesan terlalu panjang. Batasi hingga 2.000 karakter.';
  if (!text && !loadAttachment) return null;
  if (!process.env.OPENAI_API_KEY) return 'AI belum diaktifkan. Isi OPENAI_API_KEY pada .env.local lalu mulai ulang bot.';

  const attachment = loadAttachment ? await loadAttachment() : undefined;
  const row = await pool.query<{ messages: unknown }>('SELECT messages FROM admin_ai_chats WHERE phone=$1', [phone]);
  const stored = row.rows[0]?.messages;
  const history: Message[] = Array.isArray(stored) ? stored.filter((m): m is Message =>
    !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12) : [];
  const note = attachment ? `[Lampiran: ${attachment.filename ?? attachment.mediaType}]` : '';
  const question = [text, note].filter(Boolean).join('\n');
  const messages: ModelMessage[] = [...history, requestMessage(text, attachment)];
  const answer = await reply(messages);
  if (!answer) return 'AI tidak memberikan jawaban. Coba pertanyaan lain.';
  await pool.query(
    `INSERT INTO admin_ai_chats(phone,messages) VALUES($1,$2::jsonb)
     ON CONFLICT(phone) DO UPDATE SET messages=EXCLUDED.messages,updated_at=now()`,
    [phone, JSON.stringify([...history, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-12))]);
  return answer.length > 3500 ? answer.slice(0, 3497) + '...' : answer;
}

export async function adminAiMessage(pool: Pool, phone: string, text: string, loadAttachment?: AttachmentLoader, reply: Generate = generate): Promise<string | null> {
  const previous = queues.get(phone) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(() => run(pool, phone, text, loadAttachment, reply));
  const done = result.then(() => {}, () => {});
  queues.set(phone, done);
  void done.then(() => { if (queues.get(phone) === done) queues.delete(phone); });
  try { return await result; }
  catch (error) {
    if (error instanceof Error && error.name === 'UnsupportedAiAttachment') return error.message;
    console.error('Permintaan AI admin gagal:', error);
    return 'AI sedang tidak tersedia. Coba lagi nanti atau periksa konfigurasi API.';
  }
}
