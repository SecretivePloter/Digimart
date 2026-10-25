# Digimart — rancangan teknis awal

Status: rancangan untuk ditinjau sebelum integrasi akun produksi. Produk contoh YouTube berasal dari briefing; katalog produksi dikelola admin.

## Alur pelanggan

1. `list` menampilkan produk dan status stok. Nama atau nomor produk membuka detail, ketentuan, varian, harga.
2. Pelanggan memilih varian. `beli <produk>`, `konfirmasi beli <produk>`, `konfirmasi beli`, atau `payment` hanya dilanjutkan jika varian sudah jelas.
3. Bot mengecek status varian. Ready/Terbatas dapat lanjut; Habis menunggu persetujuan admin tanpa batas waktu. Selama menunggu, QRIS belum dibuat.
4. Bot menampilkan harga dasar, biaya pembayaran terkonfigurasi, dan total. Setelah konfirmasi, backend membuat order dengan ID unik dan QRIS dinamis Midtrans, kedaluwarsa 15 menit.
5. Webhook Midtrans diverifikasi dan diproses idempoten. Setelah lunas, bot meminta Gmail pelanggan jika produk membutuhkannya, lalu memberi alert ke semua admin terdaftar. Nomor pembeli selalu nomor penerima.
6. Admin mengirim produk langsung ke WhatsApp pembeli. `selesai <order-id>` atau balasan `selesai` pada alert menandai selesai. Masa garansi dihitung sejak selesai menurut durasi varian.

QRIS kedaluwarsa: tutup order, beri tahu pelanggan, dan minta order baru. Jika pembayaran masuk dekat waktu kedaluwarsa, status otoritatif Midtrans harus diperiksa sebelum menutup order. Gagal proses setelah lunas: admin menandai `gagal <order-id> <alasan>`; refund ditangani di luar bot, dengan status yang tetap terlihat di laporan.

## Komponen

- WhatsApp Business Platform Cloud API: webhook pesan masuk dan pengiriman pesan pelanggan/admin.
- Backend API: parser perintah, state percakapan, katalog, order, aturan admin, dan webhook terverifikasi.
- Adaptor Midtrans Core API: membuat charge QRIS, mengambil status, menangani notifikasi dan kedaluwarsa.
- Database relasional: transaksi pesanan dan audit; nomor admin terdaftar.
- Dashboard web dengan login admin: pencarian dan filter order, katalog/varian, status stok, garansi, pelanggan, dan laporan rentang tanggal.
- Pekerja tugas terjadwal: rekonsiliasi pembayaran, penanganan kedaluwarsa, dan pengiriman notifikasi tertunda.

Kredensial Meta dan Midtrans disimpan di sisi server. Webhook tidak boleh langsung mengubah status dari isi pesan tanpa verifikasi sumber. Aksi admin hanya berlaku untuk nomor yang diizinkan, disimpan bersama aktor dan waktu. Perintah dan webhook berulang tidak boleh membuat charge ganda atau menggandakan perubahan status.

## Data inti

- `products`: slug, nomor katalog, nama, deskripsi, ketentuan, aktif.
- `variants`: product_id, nama, harga dasar IDR, status stok (ready/terbatas/habis), durasi garansi hari, perlu_gmail, aktif.
- `customers`: nomor WhatsApp unik, waktu pertama/terakhir berinteraksi.
- `orders`: ID publik, customer_id, variant_id, snapshot nama/harga/ketentuan, biaya pembayaran, total tagihan, biaya gateway aktual, penerimaan bersih, status order, Gmail untuk order terkait, waktu dibuat/lunas/selesai, awal/akhir garansi, admin penyelesai.
- `payments`: order_id, provider, charge ID, status, masa berlaku, referensi dan payload terpilah.
- `admins`: nomor WhatsApp unik, aktif, peran.
- `order_events`: order_id, jenis kejadian, aktor, waktu, alasan, referensi webhook; log audit.
- `conversation_states`: customer_id, produk/varian terpilih, tahapan, kedaluwarsa state.
- `outbox`: pesan WhatsApp yang perlu dikirim, status kirim, jumlah percobaan.

Status order: `awaiting_stock` → `awaiting_payment` → `paid` → `awaiting_customer_data` → `processing` → `completed`. Cabang lain: `stock_rejected`, `expired`, `failed_processing`. Status pembayaran terpisah dari status pemenuhan produk.

## Pembukuan

Laporan rentang tanggal memakai waktu pembayaran berhasil (zona Asia/Jakarta). Tampilkan jumlah dan nilai order lunas, harga dasar, biaya pembayaran yang dibebankan, total dibayar, biaya gateway aktual, penerimaan bersih, order selesai, dan order gagal proses. Pesanan kedaluwarsa tidak dihitung sebagai penjualan. `failed_processing` tetap dicatat sebagai uang diterima dengan penanda refund di luar bot, bukan diam-diam dikurangkan karena belum ada bukti pengembalian. Perubahan data keuangan harus dapat diaudit.

## Contoh produk briefing

YouTube Premium + YT Music, Family Plan: Head 1 bulan Rp25.000; Invite 1 bulan Rp12.000. Syarat contoh: Gmail bukan GSuite, akun pembeli, 25–30 hari dihitung satu bulan, Head dapat invite 5 orang, lupa password bukan garansi seller. Ketentuan dan lama garansi final masih perlu diisi sebelum produk diaktifkan.

## Keputusan tersisa sebelum produksi

- Tarif Midtrans khusus kategori produk digital, besaran biaya pembayaran yang ditampilkan, dan apakah biaya tersebut termasuk komponen pajak.
- Nama usaha, akun Meta Business, nomor Cloud API, akun Midtrans, domain HTTPS, hosting dan database.
- Durasi serta cakupan garansi setiap varian; katalog produk nyata.
- Akun admin awal dan aturan login dashboard; prosedur refund manual serta penanganan sengketa.
