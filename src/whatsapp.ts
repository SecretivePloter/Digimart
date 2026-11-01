import makeWASocket, { DisconnectReason, normalizeMessageContent, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { Pool } from 'pg';
import { database } from './services.js';
import { buyerMessage } from './buyer-chat.js';
import { reconcilePayments } from './order-operations.js';

const pool = database();
const queues = new Map<string, Promise<void>>();
let stopped = false;

function bodyText(message: {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
}) {
  return (message.conversation ?? message.extendedTextMessage?.text ?? '').trim();
}

function outboxText(type: string, payload: Record<string, unknown>) {
  if (type === 'text') return String(payload.text);
  if (type === 'request_email') return `Pembayaran *${payload.order_id}* berhasil. Ketik email ${payload.order_id} alamat@email.com untuk diproses admin.`;
  if (type === 'order_expired') return `QRIS pesanan *${payload.order_id}* kedaluwarsa. Pesanan dibatalkan.`;
  if (type === 'order_paid') return `🔔 Pesanan *${payload.order_id}* lunas.\nProduk: ${payload.product}\nVarian: ${payload.variant}\nEmail: ${payload.email ?? "tidak diperlukan / belum tersedia"}\nPelanggan: +${payload.phone}\nSegera proses pesanan.`;
  return null;
}

async function drainOutbox(sock: ReturnType<typeof makeWASocket>, pool: Pool) {
  await pool.query(`UPDATE message_outbox SET status='failed'
    WHERE status='sending' AND claimed_at < now()-interval '5 minutes'`);
  const result = await pool.query<{
    id: string; recipient_wa_number: string; message_type: string; payload: Record<string, unknown>;
  }>(`
    UPDATE message_outbox SET status = 'sending', claimed_at=now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM message_outbox
      WHERE status IN ('pending', 'failed') AND next_attempt_at <= now() AND attempts < 5
      ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, recipient_wa_number, message_type, payload
  `);
  for (const row of result.rows) {
    try {
      if ((process.env.MIDTRANS_ENV ?? 'sandbox') === 'sandbox' &&
          !(process.env.WA_TEST_NUMBERS ?? '').split(',').map(s=>s.trim()).includes(row.recipient_wa_number)) {
        await pool.query(`UPDATE message_outbox SET status='pending',attempts=attempts-1,
          next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,[row.id]);
        continue;
      }
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
  const { state, saveCreds } = await useMultiFileAuthState(process.env.WA_AUTH_DIR ?? '.wa-auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({level:'silent'}) });
  let connected = false;
  sock.ev.on('creds.update', () => {void saveCreds().catch(()=>{
    console.error('WhatsApp session could not be persisted');process.exit(1);
  });});
  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      if (process.env.WA_PAIRING_MODE === 'true') qrcode.generate(qr, { small: true });
      else console.error('WhatsApp pairing required; run private pairing mode in a terminal.');
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
        setTimeout(() => void connect().catch(()=>process.exit(1)), 5000);
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
      if (body && message.key.id) {
        const allowed=(process.env.WA_TEST_NUMBERS ?? '').split(',').map(s=>s.trim());
        if ((process.env.MIDTRANS_ENV ?? 'sandbox')==='sandbox' && !allowed.includes(sessionId)) continue;
        const id=message.key.id;
        const task=(queues.get(sessionId) ?? Promise.resolve()).then(async()=>{
          if((await pool.query('SELECT 1 FROM incoming_messages WHERE sender=$1 AND message_id=$2',[sessionId,id])).rowCount) return;
          try {
            const reply=await buyerMessage(pool,sessionId,body);
            await sock.sendMessage(jid,{text:reply});
            await pool.query('INSERT INTO incoming_messages(sender,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[sessionId,id]);
          } catch {
            console.error('Incoming message processing failed; no secrets logged.');
            await sock.sendMessage(jid,{text:'Permintaan belum dapat diproses. Cek status pesanan atau hubungi admin sebelum mengulang pembayaran.'});
          }
        }).catch(()=>console.error('Message transport unavailable'));
        queues.set(sessionId,task);
        void task.finally(()=>{if(queues.get(sessionId)===task) queues.delete(sessionId);});
      }
    }
  });
  let draining=false;
  const timer = setInterval(() => {
    if (connected && !draining) { draining=true; void drainOutbox(sock,pool)
      .catch(()=>console.error('Outbox temporarily unavailable')).finally(()=>{draining=false;}); }
  }, 3000);
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') clearInterval(timer);
  });
}

for(const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stopped = true; void pool.end().then(() => process.exit(0)); });
void pool.query(`UPDATE message_outbox SET status = 'failed' WHERE status = 'sending'`)
  .then(() => connect())
  .catch(() => { console.error('Startup failed; check private configuration and database connectivity.'); process.exit(1); });

let reconciling=false;
setInterval(()=>{if(reconciling || stopped) return; reconciling=true; void reconcilePayments(pool).catch(()=>console.error('Payment reconciliation unavailable')).finally(()=>{reconciling=false;});},30000);
