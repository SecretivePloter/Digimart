import makeWASocket, { DisconnectReason, downloadMediaMessage, normalizeMessageContent, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { readFile } from 'node:fs/promises';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import type { Pool } from 'pg';
import { database } from './services.js';
import { messageRoute, groupReply } from './group-chat.js';
import { buyerMessage } from './buyer-chat.js';
import { reconcilePayments } from './order-operations.js';
import { manualPaymentsActive, qrisPath, sandboxMessaging, verifyManualConfig } from './payment-config.js';
import { submitManualEvidence } from './manual-payments.js';
import { downloadCommand, downloaderHelp, withDownloadedMedia } from './downloader.js';

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
      if (sandboxMessaging() &&
          !(process.env.WA_TEST_NUMBERS ?? '').split(',').map(s=>s.trim()).includes(row.recipient_wa_number)) {
        await pool.query(`UPDATE message_outbox SET status='pending',attempts=attempts-1,
          next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,[row.id]);
        continue;
      }
      if(row.message_type==='manual_evidence') {
        const evidence=(await pool.query('SELECT m.evidence_path,m.evidence_mime FROM manual_payment_reviews m WHERE m.id=$1 AND EXISTS(SELECT 1 FROM admins WHERE wa_number=$2 AND active)',[row.payload.review_id,row.recipient_wa_number])).rows[0];
        if(!evidence) throw Error('Evidence access unavailable');
        const data=await readFile(evidence.evidence_path);
        await sock.sendMessage(`${row.recipient_wa_number}@s.whatsapp.net`,evidence.evidence_mime==='application/pdf'?{document:data,mimetype:evidence.evidence_mime,fileName:`bukti-${row.payload.order_id}.pdf`}:{image:data,caption:`Bukti ${row.payload.order_id}. Cocokkan dengan transaksi GoPay Merchant.`});
      } else {
        const text = outboxText(row.message_type, row.payload);
        if (!text) throw new Error('Unsupported message type');
        await sock.sendMessage(`${row.recipient_wa_number}@s.whatsapp.net`, { text });
      }
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
      const route = messageRoute(message.key);
      if (!route) continue;
      const { sessionId, isGroup } = route;
      const content = normalizeMessageContent(message.message);
      const body = content && (bodyText(content) || content.imageMessage?.caption || content.documentMessage?.caption || '');
      const media=content?.imageMessage??content?.documentMessage;
      console.log(`Pesan masuk: ${jid.endsWith('@lid') ? 'LID' : 'nomor'}, teks: ${body ? 'ya' : 'tidak'}`);
      if ((body || media) && message.key.id) {
        const allowed=(process.env.WA_TEST_NUMBERS ?? '').split(',').map(s=>s.trim());
        if (sandboxMessaging() && !allowed.includes(sessionId)) continue;
        const id=message.key.id;
        const task=(queues.get(sessionId) ?? Promise.resolve()).then(async()=>{
          if((await pool.query('SELECT 1 FROM incoming_messages WHERE sender=$1 AND message_id=$2',[isGroup ? `${jid}:${sessionId}` : sessionId,id])).rowCount) return;
          try {
            const download=downloadCommand(body??'');
            if(download!==null&&!media) {
              if(process.env.DOWNLOADER_ENABLED!=='true')await sock.sendMessage(jid,{text:'Downloader belum aktif.'});
              else if(!download.input)await sock.sendMessage(jid,{text:downloaderHelp});
              else {
                try {
                  await withDownloadedMedia(sessionId,download.input,download.command,async (path,kind)=>{
                    if(kind==='image') return sock.sendMessage(jid,{image:{url:path}});
                    if(kind==='audio') return sock.sendMessage(jid,{audio:{url:path},mimetype:'audio/mpeg',ptt:false});
                    return sock.sendMessage(jid,{video:{url:path},mimetype:'video/mp4'});
                  });
                } catch(e) {await sock.sendMessage(jid,{text:e instanceof Error?e.message:'Unduhan gagal. Coba lagi nanti.'});}
              }
            } else if(isGroup) {
              const reply=await groupReply(pool,body??'',Boolean(media));
              if(reply) await sock.sendMessage(jid,{text:reply},{quoted:message});
            } else if(media) {
              const match=body?.trim().match(/^bukti\s+(ORD-[A-F0-9]{16})$/i);
              if(!match) { await sock.sendMessage(jid,{text:'Kirim ulang foto/PDF bukti dengan caption: bukti ORD-... sesuai ID pesanan.'}); return; }
              if(Number(media.fileLength??0)>5*1024*1024) {await sock.sendMessage(jid,{text:'Bukti maksimal 5 MB.'});return;}
              const stream=await downloadMediaMessage(message,'stream',{});
              const chunks:Buffer[]=[];let size=0;
              for await(const chunk of stream) {size+=chunk.length;if(size>5*1024*1024){stream.destroy();throw Error('Bukti maksimal 5 MB.');}chunks.push(chunk);}
              await submitManualEvidence(pool,sessionId,match[1].toUpperCase(),{data:Buffer.concat(chunks),mime:media.mimetype??''});
              await sock.sendMessage(jid,{text:`Bukti ${match[1].toUpperCase()} diterima. Status: menunggu verifikasi admin. Pesanan belum dianggap lunas.`});
            } else {
              const reply=await buyerMessage(pool,sessionId,body??'');
              if(manualPaymentsActive()&&reply.includes('\nQRIS manual\n')) await sock.sendMessage(jid,{image:await readFile(qrisPath()),caption:reply});
              else await sock.sendMessage(jid,{text:reply});
            }
            await pool.query('INSERT INTO incoming_messages(sender,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[isGroup ? `${jid}:${sessionId}` : sessionId,id]);
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
void verifyManualConfig().then(()=>pool.query(`UPDATE message_outbox SET status = 'failed' WHERE status = 'sending'`))
  .then(() => connect())
  .catch(() => { console.error('Startup failed; check private configuration and database connectivity.'); process.exit(1); });

let reconciling=false;
setInterval(()=>{if(reconciling || stopped) return; reconciling=true; void reconcilePayments(pool).catch(()=>console.error('Payment reconciliation unavailable')).finally(()=>{reconciling=false;});},30000);
