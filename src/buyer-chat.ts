import type { Pool } from 'pg';
import { listCatalog,productDetail } from './catalog.js';
import { formatCatalog,formatProduct } from './wa-format.js';
import { calculateQuote,feePolicyFromEnv } from './quote.js';
import { createOrder,midtransFromEnv,validEmail } from './orders.js';
import { completeOrder,orderStatus,salesReport,supplyEmail } from './order-operations.js';
import { adminMessage } from './admin-wa.js';
import { startManualOrder } from './manual-payments.js';
import { manualPaymentsActive, merchantName, verifyManualConfig } from './payment-config.js';

export async function buyerMessage(pool: Pool, phone: string, text: string): Promise<string> {
  if(!/^[1-9][0-9]{7,14}$/.test(phone)) return 'Nomor WhatsApp belum dapat diverifikasi. Hubungi admin.';
  const lower=text.trim().toLowerCase();
  const command=lower.split(/\s+/);
  if(command[0]==='status' && command[1]) {
    const o=await orderStatus(pool,phone,command[1].toUpperCase());
    return o?`${o.public_id}\n${o.product_name_snapshot} / ${o.variant_name_snapshot}\nPesanan: ${o.status}\nPembayaran: ${o.payment_status ?? 'sedang disiapkan'}\nTotal: Rp${Number(o.total_idr).toLocaleString('id-ID')}`:'Pesanan tidak ditemukan.';
  }
  if(command[0]==='selesai' && command[1]) {
    await completeOrder(pool,phone,command[1].toUpperCase());return 'Pesanan sudah ditandai selesai.';
  }
  if(lower==='/admin penjualan') return JSON.stringify(await salesReport(pool,phone));
  if(command[0]==='email' && command[1] && command[2]) {
    await supplyEmail(pool,phone,command[1].toUpperCase(),text.trim().split(/\s+/)[2]);return 'Email tersimpan. Admin akan memproses pesanan.';
  }
  const admin=await adminMessage(pool,phone,text);if(admin!==null) return admin;
  const customer=(await pool.query(`INSERT INTO customers(wa_number) VALUES($1)
    ON CONFLICT(wa_number) DO UPDATE SET last_seen_at=now() RETURNING id`,[phone])).rows[0];
  const state=(await pool.query(`SELECT s.*,p.slug FROM conversation_states s
    LEFT JOIN products p ON p.id=s.selected_product_id WHERE customer_id=$1`,[customer.id])).rows[0];
  if(lower==='list' || lower==='batal') {
    await pool.query('DELETE FROM conversation_states WHERE customer_id=$1',[customer.id]);
    return formatCatalog(await listCatalog(pool));
  }
  const product=state?.slug?await productDetail(pool,state.slug):null;
  if(state?.step==='email') {
    if(!validEmail(text.trim())) return 'Masukkan email yang valid, atau ketik batal.';
    await pool.query(`UPDATE conversation_states SET fulfillment_email=$2,step='confirm',updated_at=now() WHERE customer_id=$1`,[customer.id,text.trim()]);
    return `Email: ${text.trim()}\nTotal: Rp${Number(state.quoted_total_idr).toLocaleString('id-ID')}\nKetik konfirmasi beli untuk membuat tagihan.`;
  }
  if(['konfirmasi','konfirmasi beli','payment'].includes(lower)) {
    if (process.env.PAYMENTS_ENABLED === 'false') return 'Pembayaran otomatis belum tersedia. Hubungi admin untuk informasi pemesanan. Belum ada tagihan yang dibuat.';
    if(!state?.selected_variant_id || state.step!=='confirm') return 'Pilih produk dan varian dahulu. Ketik list.';
    if(!product) return 'Produk sudah tidak aktif. Ketik list.';
    if(manualPaymentsActive()) {
      await verifyManualConfig();
      const order=await startManualOrder(pool,phone,String(state.selected_variant_id),{
        email:state.fulfillment_email??undefined,expectedTotal:Number(state.quoted_total_idr)});
      return `Pesanan ${order.id}\n${order.product} / ${order.variant}\nTotal: Rp${order.total.toLocaleString('id-ID')}\nQRIS manual\nMerchant: ${merchantName()}\nMasukkan nominal persis sesuai tagihan. Kirim foto bukti dengan caption: bukti ${order.id}\nBukti akan diperiksa admin melalui GoPay Merchant, bukan otomatis dianggap lunas.\nCek: status ${order.id}`;
    }
    const order=await createOrder(pool,phone,String(state.selected_variant_id),midtransFromEnv(),{
      email:state.fulfillment_email ?? undefined,expectedTotal:Number(state.quoted_total_idr)});
    return `Pesanan ${order.publicId}\nTotal: Rp${order.totalIdr.toLocaleString('id-ID')}\n`+
      (order.status==='awaiting_payment'?`QRIS ${process.env.MIDTRANS_ENV ?? 'sandbox'}: ${order.qrUrl}\nBatas pembayaran mengikuti tagihan (15 menit sejak dibuat).`:
        'Tagihan sedang direkonsiliasi. Jangan membuat pesanan pengganti; hubungi admin.')+
      `\nCek: status ${order.publicId}`;
  }
  if(/^\d+$/.test(lower) && product && state.step==='variant') {
    const variant=product.variants[Number(lower)-1];
    if(!variant) return 'Nomor varian tidak valid.';
    if(variant.stock_status==='out') return 'Varian habis dan tidak bisa dipesan. Pilih varian lain atau ketik list.';
    if (process.env.PAYMENTS_ENABLED === 'false') return `${product.name} / ${variant.name}\nHarga produk: Rp${Number(variant.base_price_idr).toLocaleString('id-ID')}\nPembayaran otomatis belum tersedia. Hubungi admin untuk informasi pemesanan. Belum ada tagihan yang dibuat.`;
    const quote=calculateQuote(Number(variant.base_price_idr),feePolicyFromEnv());
    await pool.query(`UPDATE conversation_states SET selected_variant_id=$2,step=$3,
      fulfillment_email=NULL,quoted_total_idr=$4,updated_at=now() WHERE customer_id=$1`,
      [customer.id,variant.id,variant.requires_email?'email':'confirm',quote.total_idr]);
    return `${product.name} / ${variant.name}\nHarga: Rp${quote.base_price_idr.toLocaleString('id-ID')}\nBiaya: Rp${quote.payment_fee_idr.toLocaleString('id-ID')}\nTotal: Rp${quote.total_idr.toLocaleString('id-ID')}\nNomor penerima: +${phone}\n`+
      (variant.requires_email?'Kirim email penerima.':'Ketik konfirmasi beli untuk membuat tagihan.');
  }
  const selector=lower.replace(/^(?:beli|konfirmasi beli)\s+/,'');
  const listing=await listCatalog(pool);
  const match=listing.find(p=>p.name.toLowerCase()===selector || p.slug===selector || String(p.catalog_number)===selector);
  const chosen=match?await productDetail(pool,match.slug):null;
  if(!chosen) return 'Ketik list untuk katalog, status ORD-... untuk pesanan, atau batal untuk memilih ulang.';
  await pool.query(`INSERT INTO conversation_states(customer_id,selected_product_id,step)
    SELECT $1,id,'variant' FROM products WHERE slug=$2
    ON CONFLICT(customer_id) DO UPDATE SET selected_product_id=excluded.selected_product_id,
      selected_variant_id=NULL,fulfillment_email=NULL,quoted_total_idr=NULL,step='variant',updated_at=now()`,[customer.id,chosen.slug]);
  return formatProduct(chosen);
}
