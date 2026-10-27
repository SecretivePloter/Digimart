import type { Pool } from 'pg';
import { activeAdmin, catalogForAdmin, saveProduct, publicError, type CatalogProduct } from './catalog-manage.js';
export async function adminMessage(pool: Pool, phone: string, text: string): Promise<string | null> {
  if (!/^\/admin(?:\s|$)/i.test(text)) return null;
  if (!await activeAdmin(pool,phone)) return 'Akses admin tidak tersedia untuk pengirim ini.';
  try {
    const [head,...args]=text.split('|').map(s=>s.trim());
    const [,operation='help',slug]=head.split(/\s+/);
    if (operation==='help') return [
      '*Kelola katalog*', '/admin list', '/admin lihat slug', '/admin tambah slug | Nama produk',
      '/admin nama slug | Nama baru', '/admin deskripsi slug | Isi deskripsi', '/admin ketentuan slug | Isi ketentuan',
      '/admin varian slug | Nama varian | Harga rupiah',
      '/admin ubah-varian slug | ID varian | Nama | Harga | ready/limited/out | Hari garansi | Label garansi | perlu email true/false | aktif true/false',
      '/admin hapus-varian slug | ID varian', '/admin publikasi slug', '/admin arsip slug',
      'Lihat ID varian lewat /admin lihat slug. Arsip menyembunyikan produk dan mempertahankan riwayat order.'
    ].join('\n');
    const catalog=await catalogForAdmin(pool);
    if (operation==='list') return catalog.map(p=>`${p.catalog_number}. ${p.slug} — ${p.active?'Aktif':'Draf/arsip'}`).join('\n') || 'Belum ada produk.';
    if (!slug) throw new Error('Isi slug produk. Ketik /admin help.');
    if (operation==='tambah') {
      const p: CatalogProduct={slug,name:args[0]??'',description:'',terms:'',active:false,variants:[]};
      await saveProduct(pool,p,phone); return 'Produk dibuat sebagai draf.';
    }
    const p=catalog.find(p=>p.slug===slug);
    if (!p) throw new Error('Produk tidak ditemukan.');
    if (operation==='lihat') return `${p.name}\nSlug: ${p.slug}\nDeskripsi: ${p.description}\nKetentuan: ${p.terms}\n`+
      p.variants.map(v=>`ID ${v.id}: ${v.name}, Rp${v.base_price_idr}, ${v.stock_status}, ${v.active?'aktif':'nonaktif'}, garansi ${v.warranty_label || 'belum diisi'}, perlu email: ${v.requires_email}`).join('\n');
    if (operation==='nama') p.name=args.join(' | ');
    else if (operation==='deskripsi') p.description=args.join(' | ');
    else if (operation==='ketentuan') p.terms=args.join(' | ');
    else if (operation==='publikasi') p.active=true;
    else if (operation==='arsip') p.active=false;
    else if (operation==='varian') p.variants.push({name:args[0]??'',base_price_idr:Number(args[1]),stock_status:'out',warranty_days:0,warranty_label:'',requires_email:false,active:false});
    else if (operation==='hapus-varian' || operation==='ubah-varian') {
      const v=p.variants.find(v=>v.id===args[0]); if (!v) throw new Error('ID varian tidak ditemukan.');
      if (operation==='hapus-varian') v.active=false;
      else {
        if (args.length!==8 || !['true','false'].includes(args[6]) || !['true','false'].includes(args[7])) throw new Error('Format varian salah. Ketik /admin help.');
        Object.assign(v,{name:args[1],base_price_idr:Number(args[2]),stock_status:args[3],warranty_days:Number(args[4]),warranty_label:args[5],requires_email:args[6]==='true',active:args[7]==='true'});
      }
    } else throw new Error('Perintah tidak dikenal. Ketik /admin help.');
    await saveProduct(pool,p,phone); return 'Katalog berhasil diperbarui.';
  } catch(e) { return publicError(e); }
}
