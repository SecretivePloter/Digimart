import { downloadMediaMessage, normalizeMessageContent, type WAMessage } from '@whiskeysockets/baileys';
import { unzipSync } from 'fflate';
import type { AiAttachment } from './admin-ai.js';

const MAX_BYTES = 8 * 1024 * 1024;

export class UnsupportedAiAttachment extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedAiAttachment'; }
}

export function docxText(data: Buffer) {
  let xml: Uint8Array | undefined;
  const files = unzipSync(data, { filter: entry =>
    entry.name === 'word/document.xml' && entry.originalSize <= 2_000_000 });
  xml = files['word/document.xml'];
  if (!xml) throw new UnsupportedAiAttachment('Dokumen Word tidak dapat dibaca atau terlalu besar.');
  const content = Buffer.from(xml).toString('utf8')
    .replace(/<\/w:p>/g, '\n').replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, entity =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity);
  return content.trim().slice(0, 40_000);
}

export function supportedAttachment(message: WAMessage) {
  const content = normalizeMessageContent(message.message);
  return !!(content?.imageMessage || content?.documentMessage);
}

export async function readWhatsAppAttachment(message: WAMessage): Promise<AiAttachment> {
  const content = normalizeMessageContent(message.message);
  const image = content?.imageMessage;
  const document = content?.documentMessage;
  if (!image && !document) throw new UnsupportedAiAttachment('Kirim gambar atau dokumen PDF, DOCX, atau TXT.');
  const size = Number(image?.fileLength ?? document?.fileLength ?? 0);
  if (size > MAX_BYTES) throw new UnsupportedAiAttachment('Lampiran terlalu besar. Batasnya 8 MB.');
  const mime = (image?.mimetype ?? document?.mimetype ?? '').split(';')[0].toLowerCase();
  const filename = document?.fileName ?? undefined;
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const isDocx = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (mime === 'application/octet-stream' && !!filename?.toLowerCase().endsWith('.docx'));
  const isTxt = mime === 'text/plain' || (mime === 'application/octet-stream' && !!filename?.toLowerCase().endsWith('.txt'));
  if (image ? !imageTypes.includes(mime) : !(mime === 'application/pdf' || isDocx || isTxt))
    throw new UnsupportedAiAttachment('Format belum didukung. Kirim JPG, PNG, WEBP, PDF, DOCX, atau TXT (maksimal 8 MB).');
  const stream = await downloadMediaMessage(message, 'stream', {});
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of stream) {
    received += chunk.length;
    if (received > MAX_BYTES) {
      stream.destroy();
      throw new UnsupportedAiAttachment('Lampiran terlalu besar. Batasnya 8 MB.');
    }
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (isDocx) return { data: Buffer.from(docxText(data)), mediaType: 'text/plain', filename: filename ?? 'dokumen.docx' };
  if (isTxt) return { data: Buffer.from(data.toString('utf8').slice(0, 40_000)), mediaType: 'text/plain', filename: filename ?? 'dokumen.txt' };
  return { data, mediaType: mime, filename };
}
