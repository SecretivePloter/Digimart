import makeWASocket, { DisconnectReason, normalizeMessageContent, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { adminMessage } from './admin-wa.js';
import qrcode from 'qrcode-terminal';
import type { Pool } from 'pg';
import { database } from './services.js';
import { listCatalog, productDetail } from './catalog.js';
import { formatCatalog, formatProduct } from './wa-format.js';

const pool = database();
const sessions = new Map<string, { product: Awaited<ReturnType<typeof productDetail>>; variantId?: string }>();
let stopped = false;

function bodyText(message: {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
}) {
  return (message.conversation ?? message.extendedTextMessage?.text ?? '').trim();
}

async function incoming(sock: ReturnType<typeof makeWASocket>, jid: string, sessionId: string, text: string) {
  if (!text) return;
  const adminReply=await adminMessage(pool,sessionId,text);
  if (adminReply!==null) { await sock.sendMessage(jid,{text:adminReply}); return; }
  const lower = text.toLowerCase().trim();
  if (lower === 'list') {
    await sock.sendMessage(jid, { text: formatCatalog(await listCatalog(pool)) });
    return;
  }
  const session = sessions.get(sessionId);
  if (/^\d+$/.test(lower) && session?.product) {
    const selected = session.product.variants[Number(lower) - 1];
    if (selected) {
      session.variantId = selected.id;
      await sock.sendMessage(jid, {
        text: `Pilihan: *${session.product.name} — ${selected.name}*.\nKetik *konfirmasi beli* untuk melanjutkan.`,
      });
      return;
    }
  }
  const namedSelection = lower.match(/^(?:beli|konfirmasi beli)\s+(.+)$/);
  if (namedSelection) {
    const named = await productDetail(pool, namedSelection[1]);
    if (named) {
      sessions.set(sessionId, { product: named });
      await sock.sendMessage(jid, { text: formatProduct(named) });
      return;
    }
  }
  if (lower === 'payment' || lower === 'konfirmasi beli') {
    await sock.sendMessage(jid, {
      text: session?.variantId
        ? 'Varian telah dipilih. Pembuatan QRIS lewat WhatsApp akan diaktifkan setelah uji koneksi dan tarif Midtrans selesai.'
        : 'Pilih produk dan varian dahulu. Ketik *list* untuk melihat katalog.',
    });
    return;
  }
  const listing = await listCatalog(pool);
  const selectedRow = listing.find(row => row.name.toLowerCase() === lower);
  const product = await productDetail(pool, selectedRow?.slug ?? lower);
  if (product) {
    sessions.set(sessionId, { product });
    await sock.sendMessage(jid, { text: formatProduct(product) });
    return;
  }
  await sock.sendMessage(jid, { text: 'Produk tidak ditemukan. Ketik *list* untuk melihat katalog.' });
}

function outboxText(type: string, payload: Record<string, unknown>) {
  if (type === 'request_email') return `Pembayaran *${payload.order_id}* berhasil. Kirim Gmail Anda untuk diproses admin.`;
  if (type === 'order_expired') return `QRIS pesanan *${payload.order_id}* kedaluwarsa. Pesanan dibatalkan.`;
  if (type === 'order_paid') return `🔔 Pesanan *${payload.order_id}* lunas.\nVarian: ${payload.variant}\nPelanggan: +${payload.phone}\nSegera proses pesanan.`;
  return null;
}

async function drainOutbox(sock: ReturnType<typeof makeWASocket>, pool: Pool) {
  const result = await pool.query<{
    id: string; recipient_wa_number: string; message_type: string; payload: Record<string, unknown>;
  }>(`
    UPDATE message_outbox SET status = 'sending', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM message_outbox
      WHERE status IN ('pending', 'failed') AND next_attempt_at <= now() AND attempts < 5
      ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, recipient_wa_number, message_type, payload
  `);
  for (const row of result.rows) {
    try {
      const text = outboxText(row.message_type, row.payload);
      if (!text) throw new Error('Unsupported message type');
      await sock.sendMessage(`${row.recipient_wa_number}@s.whatsapp.net`, { text });
      await pool.query(`UPDATE message_outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
    } catch {
      await pool.query(`
        UPDATE message_outbox SET status = 'failed',
          next_attempt_at = now() + interval '1 minute' * LEAST(attempts * attempts, 30)
        WHERE id = $1
      `, [row.id]);
    }
  }
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('.wa-auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });
  let connected = false;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log('Pindai QR melalui WhatsApp → Perangkat tertaut → Tautkan perangkat:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      connected = true;
      console.log('Digimart WhatsApp terhubung.');
    }
    if (connection === 'close' && !stopped) {
      connected = false;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('Sesi WhatsApp keluar. Periksa perangkat tertaut sebelum menyambungkan ulang.');
      } else {
        setTimeout(() => void connect().catch(console.error), 5000);
      }
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      const jid = message.key.remoteJid;
      if (!jid || message.key.fromMe || !message.message) continue;
      if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue;
      const alternate = message.key.remoteJidAlt;
      const phoneJid = jid.endsWith('@s.whatsapp.net') ? jid
        : alternate?.endsWith('@s.whatsapp.net') ? alternate : undefined;
      const phone = phoneJid?.split('@')[0];
      // A LID is not a phone number. Keep the chat usable even when WhatsApp
      // does not supply its alternate phone JID.
      const sessionId = phone && /^[1-9][0-9]{7,14}$/.test(phone) ? phone : jid;
      const content = normalizeMessageContent(message.message);
      const body = content && bodyText(content);
      console.log(`Pesan masuk: ${jid.endsWith('@lid') ? 'LID' : 'nomor'}, teks: ${body ? 'ya' : 'tidak'}`);
      if (body) void incoming(sock, jid, sessionId, body).catch(console.error);
    }
  });
  const timer = setInterval(() => {
    if (connected) void drainOutbox(sock, pool).catch(console.error);
  }, 3000);
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') clearInterval(timer);
  });
}

process.on('SIGINT', () => { stopped = true; void pool.end().then(() => process.exit(0)); });
void pool.query(`UPDATE message_outbox SET status = 'failed' WHERE status = 'sending'`)
  .then(() => connect())
  .catch(error => { console.error(error); process.exitCode = 1; });
