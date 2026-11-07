# Downloader WhatsApp

Perintah chat pribadi: `.fb LINK`, `.ig LINK`, `.x LINK`, `.yt LINK` (video/Shorts), dan `.ytmp3 LINK` (MP3). `/dl LINK` masih diterima, termasuk untuk video TikTok.
Carousel dikirim sesuai urutan, maksimal 10 item. Batas 32 MiB per item, 100 MiB per pekerjaan, dan 90 detik per pekerjaan. Dua unduhan dapat berjalan bersamaan. Bot hanya mengirim media yang berhasil diekstrak. Foto profil dan thumbnail video bukan hasil unduhan.

Pada VPS Ubuntu, siapkan dependensi dari folder release yang akan dipakai service:

```bash
apt-get install -y python3-venv ffmpeg
python3 -m venv /opt/lidealabs/tools/social-venv
/opt/lidealabs/tools/social-venv/bin/pip install -r tools/requirements-downloader.txt
```

Sertakan folder `tools/` dan `deploy/downloader-cases.json` dalam release. WorkingDirectory harus menunjuk ke folder aplikasi. Jalankan `npm ci`, `npm run build`, dan `npm test`. `DOWNLOADER_PYTHON` dapat menunjuk ke Python virtualenv lain. Gunakan `DOWNLOADER_ENABLED=true`. Folder sementara dapat diatur melalui `DOWNLOAD_TEMP_DIR`.

Sebelum mengganti release aktif, jalankan dari release baru sebagai user aplikasi:

```bash
node deploy/probe-downloader.mjs --cases
```

Probe mencoba tujuh tautan contoh, memeriksa hasil dengan ffprobe, lalu menghapus file uji. Probe mengembalikan status gagal bila salah satu kasus gagal. Jalankan pengujian penerimaan WhatsApp secara terpisah pada nomor penguji. Login, batas akses platform, dan jaringan VPS bisa memberi hasil berbeda.

Strategi Facebook link crawler dan daftar media vxTwitter mengikuti [Vette1123/social-media-downloader](https://github.com/Vette1123/social-media-downloader) pada e5d8a152. Lisensi sumber ada di tools/LICENSE.social-media-downloader.
