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
Riwayat JSON menyimpan teks dan nama lampiran. Dokumen DOCX/TXT dibaca sebagai teks
maksimal 40.000 karakter, PDF dan gambar dikirim ke model.

## Membuat dan mengedit gambar

Aktifkan `.ai`, lalu gunakan bahasa biasa, misalnya `Buatkan poster kopi minimalis`
atau kirim foto dengan caption `Ubah latar belakangnya menjadi biru`.
Revisi berikutnya cukup `Buat warnanya lebih hangat` tanpa unggah ulang.
Gambar juga boleh dikirim dulu, diikuti instruksi edit pada pesan berikutnya.
Tool gambar menghasilkan satu gambar per permintaan dan bot mengirimkannya sebagai
gambar WhatsApp. Ketik `.ai file` untuk mengirim ulang file asli sebagai dokumen
tanpa kompresi WhatsApp dan tanpa memanggil API gambar lagi.

Model gambar default `gpt-image-2.5-flare`, PNG, kualitas medium, ukuran otomatis.
Model dapat diganti lewat `OPENAI_IMAGE_MODEL` di environment layanan. Model percakapan
tetap memakai `OPENAI_MODEL`. Generasi gambar memakai saldo OpenAI API.
Tool hanya dipanggil untuk permintaan gambar, bukan pertanyaan teks atau analisis gambar.
Waktu tunggu hingga tiga menit; permintaan API tidak diulang otomatis.

Satu gambar referensi terakhir per admin disimpan privat di tabel `admin_ai_images`,
terpisah dari JSON riwayat dan dibatasi 8 MB. Gambar baru menggantikan yang lama.
Referensi dibersihkan saat `.ai reset`, keluar mode, atau saat pesan berikutnya
mendeteksi mode kedaluwarsa. Backup database mengikuti perlindungan database bot.
PDF/DOCX/TXT tidak disimpan sebagai berkas referensi.

Jika saldo habis, bot menyampaikan penyebabnya. Isi saldo akun/proyek API yang
memiliki kunci bot, lalu coba lagi; mengganti kunci atau restart tidak diperlukan.
Langganan ChatGPT terpisah dari saldo API. Akses admin, reset, keluar mode, dan
pengiriman ulang `.ai file` tetap dapat digunakan tanpa permintaan model baru.

Uji generasi dan edit melalui API (memakai saldo API), semua data uji di-rollback:

```sh
cd /opt/lidealabs/current
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/smoke-admin-ai-images.mjs
```

Uji ini menyimpan dua gambar sintetis di folder sementara yang dicetak di akhir.
Periksa gambar pertama persegi biru dan gambar kedua persegi merah. Ini tidak
mengirim pesan WhatsApp. Uji pengiriman ke ponsel harus dilakukan dari nomor admin.
Tambahkan `--offline` untuk menguji penyimpanan dan alur pengiriman dengan model
simulasi tanpa memakai saldo API. Hasil offline tidak membuktikan generasi OpenAI.

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

Uji API langsung dari VPS (memakai kuota OpenAI, data uji database di-rollback,
tanpa mengirim pesan WhatsApp):

```sh
cd /opt/lidealabs/current
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/smoke-admin-ai.mjs
```

Fixture gambar dan PDF sintetis tersedia di `deploy/ai-fixtures`. Uji ini memeriksa
teks dan konteks, seluruh format lampiran, reset, keluar mode, kondisi kedaluwarsa
dengan waktu dimundurkan, penolakan ukuran/format, dan handler katalog nyata.
Pengunduhan lampiran dari WhatsApp serta penerimaan di ponsel tetap memerlukan
uji penerimaan manual di bawah.

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
