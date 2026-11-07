# Asisten AI pribadi di WhatsApp

Fitur ini hanya merespons admin aktif yang terdaftar lewat `npm run admin:setup`.
Ketik `.ai` untuk masuk mode AI. Setelah itu kirim pesan biasa, gambar JPG/PNG/WEBP,
atau dokumen PDF/DOCX/TXT (maksimal 8 MB) beserta caption jika perlu.
Ketik `.ai` lagi untuk keluar. Mode berakhir otomatis setelah dua jam tanpa
pesan masuk; pesan berikutnya kembali ke alur bot Digimart. `.ai reset` menghapus
riwayat percakapan admin di database aktif bot tanpa keluar dari mode.
Pesan pembeli dan perintah katalog tetap ditangani bot Digimart.

Tambahkan ke `.env.local` pada komputer yang menjalankan bot:

```dotenv
OPENAI_API_KEY=isi_kunci_api_openai_milik_anda
# Opsional: OPENAI_MODEL=gpt-6-luna
```

Jangan kirim kunci API lewat WhatsApp atau simpan ke GitHub. Akun OpenAI API dan
penagihannya terpisah dari langganan ChatGPT.

Setelah memperbarui kode, jalankan dari folder proyek:

```powershell
npm install
npm run build
npm run db:migrate
npm run wa:start
```

Jika bot sudah berjalan, hentikan proses lamanya sebelum menjalankan `wa:start` lagi.
Uji dari nomor admin dengan `.ai`, lalu kirim `halo`. Nomor lain akan menerima penolakan akses.
Riwayat disimpan per nomor admin, maksimal enam pasang pesan terakhir. Asisten ini
tidak terhubung langsung ke percakapan ChatGPT, Library, atau data Digimart.
Kunci API yang belum tersedia akan menghasilkan petunjuk konfigurasi, bukan membuat
bot gagal memulai.
Lampiran hanya dipakai untuk permintaan saat itu; riwayat menyimpan teks dan nama lampiran,
bukan berkasnya. Dokumen DOCX/TXT dibaca sebagai teks, PDF dan gambar dikirim ke model.

## VPS LIDEALABS

Layanan systemd menggunakan `/etc/lidealabs/app.env`, bukan `.env.local` Windows.
Deployment 7 November 2026 memakai PostgreSQL lokal sesuai pilihan operator.
Sesi WhatsApp tetap di `/var/lib/lidealabs/wa-auth`. Kode berasal dari arsip Git
di release terpisah, lalu symlink `/opt/lidealabs/current` diganti atomik.
Jangan menjalankan `git pull` di folder runtime atau menjalankan bot kedua.

Perintah penerapan, setelah arsip commit diunggah ke VPS:

```sh
sh /root/release-admin-ai.sh /root/admin-ai-release.tar COMMIT_LENGKAP
```

Skrip melakukan backup database, `npm ci`, build, seluruh tes, dan migrasi melalui
`dist/migrate.js` dengan konfigurasi layanan, lalu restart `lidealabs@whatsapp`.
Migration runner mencatat nama file lengkap, sehingga `005_admin_ai.sql` dan
`006_admin_ai_mode.sql` dapat berdampingan dengan migrasi pesanan dan QRIS bernomor sama.
Tidak ada perubahan data katalog atau pembayaran dalam migrasi AI.

Rollback kode, gunakan target yang dicatat di `PREVIOUS_RELEASE` release baru:

```sh
previous=$(cat /opt/lidealabs/current/PREVIOUS_RELEASE)
test -d "$previous" && ln -s "$previous" /opt/lidealabs/current.ai-rollback
mv -Tf /opt/lidealabs/current.ai-rollback /opt/lidealabs/current
systemctl restart lidealabs@whatsapp
```

Tabel AI bersifat tambahan dan tetap disimpan saat rollback kode. Jangan restore
database lama di atas transaksi baru. Backup konfigurasi tersedia terpisah di
`/etc/lidealabs/app.env.before-ai-*`; jangan menampilkan isinya.

## Uji penerimaan dari ponsel

1. Nomor nonadmin mengirim `.ai`: ditolak, lalu `list` tetap menampilkan katalog.
2. Admin mengirim `.ai`, lalu `Ingat kode TES-742`, kemudian `Apa kode tadi?`.
3. Kirim JPG, PNG, WEBP, PDF, DOCX, TXT dengan caption pertanyaan. Uji batas 8 MB
   dan penolakan berkas di atas batas atau format lain.
4. `.ai reset`, lalu tanya kode tadi. Konteks lama hilang, mode tetap aktif.
5. `.ai` lagi, lalu `list`: katalog kembali. Uji pemilihan produk dan ringkasan
   pesanan tanpa membayar atau menyetujui pesanan nyata untuk pengujian.
6. Aktifkan lagi, jangan mengirim pesan selama lebih dari dua jam, lalu `list`.
   Pesan harus masuk alur katalog. Uji SQL dengan waktu dimundurkan memvalidasi
   kondisi kedaluwarsa, tetapi bukan bukti menunggu dua jam melalui WhatsApp.
7. Percakapan admin lain harus terpisah. Perintah AI dalam grup tidak mengaktifkan
   mode AI privat. Dalam mode AI privat, pesan biasa termasuk perintah katalog
   diteruskan ke AI sampai mode dimatikan atau kedaluwarsa.
