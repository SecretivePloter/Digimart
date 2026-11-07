# Asisten AI pribadi di WhatsApp

Fitur ini hanya merespons admin aktif yang terdaftar lewat `npm run admin:setup`.
Ketik `.ai` untuk masuk mode AI. Setelah itu kirim pesan biasa, gambar JPG/PNG/WEBP,
atau dokumen PDF/DOCX/TXT (maksimal 8 MB) beserta caption jika perlu.
Ketik `.ai` lagi untuk keluar. Mode berakhir otomatis setelah dua jam tanpa
pesan masuk; pesan berikutnya kembali ke alur bot Digimart. `.ai reset` menghapus
riwayat percakapan admin di Neon tanpa keluar dari mode.
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
