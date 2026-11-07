# Asisten AI pribadi di WhatsApp

Fitur ini hanya merespons admin aktif yang terdaftar lewat `npm run admin:setup`.
Perintah `/ai pertanyaan` mengirim pertanyaan ke OpenAI API. `/ai reset` menghapus riwayat
percakapan admin tersebut di Neon. Pesan pembeli dan perintah katalog tetap ditangani bot Digimart.

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
Uji dari nomor admin dengan `/ai halo`. Nomor lain akan menerima penolakan akses.
Riwayat disimpan per nomor admin, maksimal enam pasang pesan terakhir. Asisten ini
tidak terhubung langsung ke percakapan ChatGPT, Library, atau data Digimart.
Kunci API yang belum tersedia akan menghasilkan petunjuk konfigurasi, bukan membuat
bot gagal memulai.
