import type { Pool } from 'pg';
import { listCatalog, productDetail } from './catalog.js';
import { formatCatalog, formatProduct } from './wa-format.js';

export function messageRoute(key: {remoteJid?: string|null; remoteJidAlt?: string|null; participant?: string|null; participantAlt?: string|null}) {
  const jid=key.remoteJid;
  if(!jid) return null;
  const isGroup=jid.endsWith('@g.us');
  if(!isGroup&&!jid.endsWith('@s.whatsapp.net')&&!jid.endsWith('@lid')) return null;
  const sender=isGroup?key.participant:jid;
  const alternate=isGroup?key.participantAlt:key.remoteJidAlt;
  if(!sender) return null;
  const phoneJid=[sender,alternate].find(x=>x?.endsWith('@s.whatsapp.net'));
  const phone=phoneJid?.split('@')[0].split(':')[0];
  return {isGroup,sessionId:phone&&/^[1-9][0-9]{7,14}$/.test(phone)?phone:sender};
}

export async function groupReply(pool: Pool,text: string,media=false): Promise<string|null> {
  if(media) return null;
  const command=text.trim().toLowerCase();
  if(command==='list'||command==='/list') return formatCatalog(await listCatalog(pool));
  if(/^(status|email|bukti|selesai|konfirmasi|payment|sudah bayar|ya|\/admin)(\s|$)/i.test(command))
    return 'Untuk pesanan, pembayaran, dan layanan admin, lanjutkan lewat chat pribadi dengan bot.';
  if(!command||command.length>100) return null;
  const product=await productDetail(pool,command);
  return product?formatProduct(product)+'\n\nUntuk membeli, lanjutkan lewat chat pribadi dengan bot.':null;
}
