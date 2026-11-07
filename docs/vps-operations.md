# LIDEALABS: deployment dan operasional

Status terbaru: [QRIS manual aktif dan perintah admin](manual-qris.md). Ketentuan Midtrans
dan status pembayaran nonaktif dalam catatan lama di bawah tidak berlaku untuk checkout manual.

Pembaruan 3 November 2026: lihat [hasil migrasi dan runbook aktual](migration-local-postgres-20261103.md). Status 1 November di bawah adalah catatan historis.

Status 1 November 2026: implementasi lokal dan pengujian SQL terisolasi telah dikerjakan. VPS, sandbox Midtrans nyata, pengiriman WhatsApp, HTTPS, reboot, dan pemulihan gangguan belum diverifikasi. Produksi belum diaktifkan. Dokumen ini adalah prosedur penerapan, bukan bukti penerapan.

## Sumber dan konfigurasi

Repository: https://github.com/SecretivePloter/Digimart

Branch pekerjaan: `codex/lidealabs-deployment`, berdasarkan `origin/feat/compact-product-details` pada `16a8591`. Branch pekerjaan belum dipublikasikan. Jangan menjalankan git pull branch ini sebelum branch tersedia di remote. Jangan menimpa perubahan VPS tanpa membandingkan `git status`, branch, commit, dan konfigurasi.

Sumber lokal: `A:\PERSONAL PROJECT\Digimart`. Konfigurasi lokal `.env.local` tidak dicommit. Konfigurasi target `/etc/lidealabs/app.env`; session target `/var/lib/lidealabs/wa-auth`; release target `/opt/lidealabs/releases/<commit>`; symlink aktif `/opt/lidealabs/current`.

Isi `deploy/app.env.example` secara privat, tanpa menyalin kredensial ke chat. Fee BPS dan fixed IDR harus sesuai kesepakatan merchant. Nilai 70 dan 0 hanya fixture pengujian, bukan rekomendasi tarif. `WA_TEST_NUMBERS` wajib mencakup nomor pembeli dan admin yang disetujui. Sandbox menolak pesan di luar daftar ini, termasuk notifikasi keluar. Pengiriman produksi tidak boleh diaktifkan sebelum persetujuan.

## Diagnosis VPS dan instalasi

1. Pastikan host, SSH user, key, distro, arsitektur, Node, ruang disk, firewall, dan commit aplikasi yang benar. Catat layanan yang sudah ada. Jangan membuat sesi bot kedua ketika sesi pertama masih hidup.
2. Jalankan dari checkout VPS, menggunakan konfigurasi privat:

```sh
node --env-file=/etc/lidealabs/app.env deploy/diagnose-db.mjs
```

Script mengecek DNS dan `SELECT 1` melalui koneksi pooled/direct, dengan batas waktu dan tanpa menampilkan URL rahasia. Jika komputer lokal berhasil tetapi VPS gagal, bandingkan resolusi IPv4/IPv6, konektivitas port database, aturan egress/IP allowlist, dan konfigurasi endpoint. Jangan mematikan TLS atau mengganti kredensial secara spekulatif.

3. Gunakan Node yang memenuhi persyaratan lockfile Baileys dan mendukung `--env-file` (baseline Node 22). Jalankan `npm ci`, `npm run build`, `npm test` di direktori staging. Pastikan exit code setiap perintah nol sebelum melanjutkan.
4. Buat user sistem `lidealabs`, direktori konfigurasi root:lidealabs mode 0750, `app.env` mode 0640, dan state milik lidealabs mode 0700. Release aplikasi boleh hanya-baca; hanya direktori state yang memerlukan tulis.
5. Backup database melalui URL direct serta konfigurasi dan sesi. Uji migrasi pada salinan/branch database. Migrasi 005 telah diuji dengan PGlite lokal, belum pada branch Neon. Jalankan migrasi live hanya setelah backup terverifikasi dan bot/API dihentikan:

```sh
node --env-file=/etc/lidealabs/app.env dist/migrate.js
```

Migration runner memakai transaksi dan advisory lock. Jangan menjalankan ulang importer katalog; database lokal yang diperiksa sudah berisi 20 produk, 12 aktif, dan dua admin aktif. Tidak ada order ketika diperiksa. Migrasi mengasumsikan order lama sandbox; verifikasi kembali sebelum penerapan jika VPS memakai database berbeda atau ada transaksi baru.

6. Pasang `deploy/lidealabs@.service` ke `/etc/systemd/system/`. Pastikan `/usr/bin/node` sesuai instalasi. Template menjalankan `dist/server.js` dan `dist/whatsapp.js` sebagai lidealabs, restart saat gagal, tanpa bergantung SSH.
7. Atur domain yang benar dan DNS VPS, pasang Caddy, lalu gunakan `deploy/Caddyfile.example`. Jangan memakai placeholder sebagai domain. `ADMIN_PUBLIC_ORIGIN` harus sama dengan origin HTTPS. API hanya bind loopback; publik hanya port HTTPS. Admin API tetap memerlukan nomor admin aktif dan password terhash, sekalipun HTML login dapat diakses publik.
8. Pair WhatsApp melalui terminal privat dengan `WA_PAIRING_MODE=true`, service bot dihentikan dahulu. QR tidak boleh ditulis ke jurnal service atau chat. Setelah pairing, hentikan proses terminal dan kembalikan `WA_PAIRING_MODE=false`.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now lidealabs@server lidealabs@whatsapp
sudo systemctl status lidealabs@server lidealabs@whatsapp
curl --fail http://127.0.0.1:3000/health
```

## Perintah operasi

```sh
sudo systemctl status lidealabs@server lidealabs@whatsapp
sudo journalctl -u lidealabs@server -u lidealabs@whatsapp --since '30 minutes ago'
sudo journalctl -u lidealabs@whatsapp -f
sudo systemctl start lidealabs@server lidealabs@whatsapp
sudo systemctl stop lidealabs@whatsapp lidealabs@server
sudo systemctl restart lidealabs@server lidealabs@whatsapp
sudo systemctl is-enabled lidealabs@server lidealabs@whatsapp
```

Atur batas jurnal sesuai kapasitas VPS melalui drop-in journald, misalnya SystemMaxUse=200M dan MaxRetentionSec=14day. Pengaturan jurnal global memengaruhi layanan lain, sehingga periksa kebijakan host dahulu. Caddy template memiliki rotasi 10 MiB, lima file, tujuh hari. Jangan log payload pelanggan, key Midtrans, URL database, atau isi sesi.

Pesan pembeli: `list`, nama/nomor produk, nomor varian, email jika diminta, `konfirmasi beli`, `status ORD-...`, `batal` untuk reset pilihan. `batal` hanya mereset pilihan, tidak membatalkan tagihan yang sudah dibuat. Tagihan yang sudah ada mengikuti status Midtrans. Untuk order lama yang sudah lunas tetapi belum memiliki email: `email ORD-... alamat@email.com`.

Admin menerima pemberitahuan lunas, mengirim produk manual, lalu `selesai ORD-...`. `status ORD-...` dapat digunakan admin; pembeli hanya melihat pesanan miliknya. `/admin penjualan` memisahkan sandbox/production dan hanya menghitung order dengan paid_at. Nilai laporan adalah total bruto, bukan laba bersih atau kepastian biaya gateway aktual.

## Uji sandbox wajib sebelum produksi

Set Midtrans notification URL ke `https://DOMAIN/webhooks/midtrans`. Gunakan sandbox server key dan simulator resmi. Dokumentasi: https://docs.midtrans.com/reference/qris dan https://docs.midtrans.com/docs/https-notification-webhooks.

Catat order ID, waktu, status database, penerima notifikasi, dan bukti setiap uji. Uji katalog nyata; varian nonaktif/habis; email wajib/tidak; jumlah tagihan; QR sandbox; pending, settlement, expire, deny/cancel; notifikasi berulang; akses lintas pembeli; pengiriman manual; selesai berulang; garansi 0 dan positif. Uji restart, SSH ditutup, reboot, putus database sementara, dan putus WhatsApp sementara. Pastikan pesanan dan sesi tetap tersimpan. Lakukan gangguan terkontrol hanya pada lingkungan uji agar tidak mengganggu pembeli.

Rekonsiliasi berjalan setiap 30 detik, tanpa overlap, menggunakan status server Midtrans. Kegagalan ambigu saat membuat charge mempertahankan order payment_setup, sehingga tidak membuat charge pengganti secara buta. Order yang tidak ditemukan Midtrans tetap membutuhkan pemeriksaan operator. Worker tidak menyimpulkan lunas dari screenshot, pesan pembeli, atau timer lokal.

Outbox dapat mencoba ulang maksimal lima kali. Periksa baris failed/attempts>=5 lewat akses database privat dan bandingkan log pengiriman sebelum mengantre ulang. Jika proses mati setelah WhatsApp menerima pesan tetapi sebelum database menandai sent, notifikasi mungkin terkirim ulang. Pemenuhan dan transisi pembayaran tetap idempoten; jangan menjanjikan exactly-once delivery WhatsApp.

## Backup, pemulihan, update, rollback

`deploy/backup.sh` berjalan sebagai root, dengan BACKUP_DIR dan DATABASE_URL_UNPOOLED melalui environment privat. Script menghentikan bot yang sedang aktif untuk snapshot sesi, membuat arsip konfigurasi/sesi dan dump PostgreSQL, lalu menghidupkan bot kembali. Backup mengandung rahasia: simpan mode 0700/0600, enkripsi sebelum dikirim ke media eksternal, dan batasi akses. Jadwalkan setelah lokasi backup dan kebijakan retensi ditetapkan. Belum ada jadwal backup yang dipasang di VPS.

Pemulihan: verifikasi checksum; ekstrak arsip ke direktori staging privat; cek daftar isi/path; salin konfigurasi/sesi yang tepat setelah bot berhenti, pulihkan owner/mode; uji pg_restore ke database terpisah dahulu. Jangan restore database live atau memakai --clean tanpa persetujuan karena dapat menimpa transaksi. Pastikan hanya satu host memakai sesi WhatsApp yang sama.

Update setelah branch dipublikasikan:

```sh
git switch codex/lidealabs-deployment
git pull --ff-only origin codex/lidealabs-deployment
npm ci
npm run build
npm test
```

Jalankan di staging, bukan direktori release aktif. Simpan hash sebelumnya, backup, jalankan migrasi yang telah ditinjau, salin artefak ke release baru, alihkan symlink current secara atomik, restart kedua service, cek health dan checkout sandbox. Jangan otomatis menghapus release lama.

Rollback aplikasi: hentikan service, arahkan current ke release sebelumnya yang kompatibel dengan schema baru, restart, cek health dan status pesanan. Migrasi 005 menambah kolom/tabel/status; aplikasi lama tidak memahami seluruh status baru, jadi rollback ke sebelum fitur ini harus dinilai dahulu. Jangan rollback schema atau menghapus order untuk memperbaiki aplikasi. Gunakan forward-fix jika rollback akan mengabaikan transaksi.

## Produksi

Diperlukan akun merchant disetujui, QRIS aktif, tarif terkonfirmasi, domain HTTPS, key produksi privat, admin aktif, seluruh bukti uji sandbox, dan persetujuan eksplisit pemilik. Baru kemudian ubah MIDTRANS_ENV=production dan MIDTRANS_PRODUCTION_APPROVED=true, dengan key produksi yang sesuai. Lakukan transaksi nyata hanya setelah persetujuan khusus. Pisahkan transaksi sandbox di laporan; jangan menyebut siap berjualan sebelum notifikasi, fulfillment manual, catatan penjualan, dan layanan persisten teruji di VPS.
