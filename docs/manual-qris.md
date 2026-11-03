# QRIS manual LIDEALABS

Aktif pada 3 November 2026. Provider `qris_manual`, `PAYMENTS_ENABLED=true`.
Release pembayaran: `/opt/lidealabs/releases/20261103-qris-manual`, symlink `/opt/lidealabs/current`.
Merchant: **MUGENWORKLABS, PULSA & INTERNET**. Gambar asli dari `private/qris-gopay.png`
disalin tanpa modifikasi ke `/var/lib/lidealabs/private/qris-gopay.png`, owner lidealabs, mode 0600.
SHA256: `8b2b7c00b464d5accd78713b34452bb49995b12695ef252fb2397180b74b291e`.

## Pembeli

`list` → pilih produk → pilih varian → email bila diminta → `konfirmasi beli`.
Bot mengirim gambar QR beserta ID, nominal harga produk tanpa fee, serta nama merchant.
Pembeli mengisi nominal pada aplikasi pembayaran. Setelah membayar, kirim JPG/PNG/PDF
maksimal 5 MB dengan caption `bukti ORD-...`. Status berubah menjadi `awaiting_verification`,
bukan lunas. `status ORD-...` menunjukkan status pesanan milik pengirim.
Konfirmasi berulang pada order terbuka mengembalikan ID yang sama. `batal` mereset pilihan,
tidak membatalkan order atau mengembalikan uang. Jangan bayar ulang order yang sedang diverifikasi.

## Admin melalui WhatsApp

Perintah hanya diterima dari nomor pengirim WhatsApp yang tercatat sebagai admin aktif.
Nomor LID tanpa nomor telepon terverifikasi tidak diberi akses admin.

| Perintah | Fungsi |
|---|---|
| `/admin help` | Daftar perintah |
| `/admin pembayaran` | Bukti menunggu pemeriksaan |
| `/admin bukti ORD-...` | Mengirim salinan bukti privat ke admin peminta |
| `status ORD-...` | Memeriksa pesanan |
| `/admin setujui ORD-... \| REFERENSI_GOPAY` | Menyetujui setelah memeriksa uang masuk |
| `/admin periksa ORD-... \| Alasan minimal 5 karakter` | Menahan untuk pemeriksaan |
| `/admin tolak ORD-... \| Alasan minimal 5 karakter` | Menolak bukti, bukan menyatakan dana pasti tidak masuk |
| `/admin antrean` | Pesanan lunas yang menunggu pemenuhan |
| `selesai ORD-...` | Tandai selesai setelah produk benar-benar dikirim |
| `/admin penjualan` | Total bruto terpisah berdasarkan lingkungan pembayaran |

Sebelum setujui, cocokkan jumlah, waktu, dan referensi transaksi **di GoPay Merchant**.
Screenshot bukan bukti otoritatif dana masuk. Jangan gunakan nomor order atau referensi buatan.
Referensi dinormalisasi huruf besar dan trim, lalu dibatasi unik oleh database.
Hash bukti yang sama tidak dapat dipakai untuk melunasi dua order. Gambar yang diedit tetap
memerlukan pemeriksaan manusia; hash bukan pendeteksi semua pemalsuan.
Lock baris serta transaksi mencegah persetujuan/pencatatan ganda. Notifikasi WhatsApp masih
dapat dikirim ulang jika proses berhenti setelah pengiriman tetapi sebelum pencatatan `sent`.

## Bukti verifikasi deployment

- Backup dump berhasil direstore ke `lidealabs_qrischeck_20261103` sebelum migrasi produksi.
- Migrasi 006 berhasil. Produksi memiliki 0 order saat cutover, sehingga tidak ada transaksi
  lama yang diubah menjadi lunas. Migrasi fixture membedakan `paid_at` dari status proses tanpa bukti lunas.
- Build dan 13 tes lulus di Windows serta VPS. Uji PostgreSQL nyata di database terpisah
  membuktikan lima checkout bersamaan memakai satu order; satu referensi hanya melunasi satu
  order; persetujuan dan penyelesaian bersamaan tercatat sekali.
- Probe kode checkout yang dideploy terhadap katalog live lulus dalam transaksi rollback:
  provider manual, harga sesuai produk, fee nol, status pending, aset dapat dibaca.
- Hash seluruh baris produk sebelum/sesudah sama. Tidak ada perubahan deskripsi ringkas.
- Health 200; server dan WhatsApp active/running, NRestarts=0; log WhatsApp terhubung.
- Belum ada uji pesan pembeli dari perangkat WhatsApp nyata pada sesi ini. Probe tidak membuktikan
  gambar diterima di perangkat pembeli. Tidak ada transaksi uang sungguhan atau pelunasan produksi untuk uji.
- Midtrans dipertahankan, `MIDTRANS_ENV=sandbox`. Pembatasan nomor sandbox hanya berlaku saat
  provider Midtrans aktif; QRIS manual menerima pembeli dan mengirim notifikasi admin produksi.

## Backup dan rollback

Backup privat `/var/backups/lidealabs/qris-20261103`: `before.dump`, `cutover.dump`,
konfigurasi sebelum perubahan, arsip konfigurasi/sesi, checksum dan salinan terenkripsi age.
Release sebelumnya `/opt/lidealabs/releases/20261103-localpg` dipertahankan.
Script `deploy/activate-manual-qris.sh` adalah catatan cutover sekali pakai, bukan perintah update rutin.

Jika gagal, hentikan kedua service, backup kondisi terbaru, pulihkan `app.env.before`,
alihkan symlink ke release sebelumnya secara atomik, lalu restart dan cek health/log WhatsApp.
Migrasi bersifat tambahan; jangan drop tabel/kolom atau restore dump menimpa data live.
Rollback aplikasi lama menonaktifkan checkout dan tidak dapat memproses QRIS manual baru.
Jika sudah ada transaksi, pertahankan data dan lakukan perbaikan maju untuk memulihkan pemenuhan.

Untuk verifikasi tanpa transaksi nyata: kirim `list`, pilih produk/varian, `konfirmasi beli`,
periksa gambar, merchant, nominal, ID, lalu `status ID`. Jika menguji unggah bukti dummy,
beri tahu admin dan gunakan `/admin tolak ID | Uji dummy tanpa pembayaran`; jangan setujui.
Persetujuan serta pemenuhan nyata hanya dilakukan setelah transaksi pelanggan benar-benar masuk.
