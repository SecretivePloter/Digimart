# Downloader WhatsApp

Perintah `/dl LINK`, `/download LINK`, atau `/downloader` untuk bantuan. Kirim satu URL
video publik TikTok, Instagram, atau YouTube. Output dikirim sebagai dokumen MP4.
Maksimal 32 MiB, durasi 10 menit, batas proses 90 detik, dua proses bersamaan,
dan satu permintaan per nomor per menit. Carousel hanya mengambil video pertama.
Profil, playlist, live, sumber URL lain, serta konten yang meminta login tidak didukung.
Format dipilih MP4 berisi audio/video dalam satu file, melalui HTTP(S), tanpa transcoding.

Engine: yt-dlp official Linux executable versi `2026.10.26`, checksum diverifikasi terhadap
SHA2-256SUMS dari release resmi. Binary `/opt/lidealabs/tools/yt-dlp_linux`.
Referensi: https://github.com/yt-dlp/yt-dlp dan dokumentasi opsi pada repository tersebut.
Konfigurasi: `DOWNLOADER_ENABLED=true`, `YT_DLP_PATH`, `DOWNLOAD_TEMP_DIR=/var/lib/lidealabs/downloads`.
Child process tidak menerima environment database atau kredensial bot, tidak menggunakan shell,
konfigurasi pengguna, plugin, cookies browser, atau generic extractor. Direktori job acak privat
dibersihkan setelah pengiriman berhasil maupun gagal. Batas file diawasi saat proses berjalan.

## Hasil pengujian 3 November 2026

- Build dan 15 tes lulus di lokal/VPS, termasuk validasi URL, penolakan host/port/profil,
  pembersihan file, batas permintaan, serta regresi pembayaran QRIS.
- Unduhan nyata Instagram `https://www.instagram.com/reel/CDUMkliABpa/` berhasil:
  MP4 3.030.145 byte, header ftyp valid, lalu file dibersihkan. Probe tidak mengirim WhatsApp.
- TikTok `https://www.tiktok.com/@moxypatch/video/7206382937372134662` mengembalikan
  `Your IP address is blocked from accessing this post` dari VPS.
- YouTube `https://www.youtube.com/watch?v=jNQXAC9IVRw` meminta sign-in/verifikasi bot.
  Tidak ada cookies atau akun yang disalin atau direkayasa. Dukungan routing terpasang,
  tetapi keberhasilan unduhan TikTok/YouTube dari VPS belum terbukti.
- Pembatasan platform dapat berbeda per URL/waktu. Untuk dukungan yang konsisten pada URL
  yang dibatasi, diperlukan akses akun resmi yang diizinkan platform atau layanan unduh resmi
  dengan kredensial yang disediakan privat. Jangan menempel cookies/password ke chat.

Uji perangkat: kirim `/dl` lalu `/dl LINK_VIDEO_PUBLIK`. Periksa dokumen MP4 diterima.
Jika platform menolak, bot mengembalikan pesan kegagalan; checkout dan status pembayaran tetap tersedia.
Rollback downloader: kembalikan symlink release QRIS `/opt/lidealabs/releases/20261103-qris-manual`
dan konfigurasi `/var/backups/lidealabs/downloader-20261103/app.env.before`, lalu restart service.
Tidak ada migrasi tambahan atau perubahan data produk untuk downloader.
