# Pengelolaan katalog

Jalankan `npm install`, `npm run build`, `npm test`, dan `npm run db:migrate` dari folder proyek.

## Daftarkan admin

`npm run admin:setup -- NOMOR_ADMIN_1 NOMOR_ADMIN_2`

Nomor memakai format internasional tanpa +. Perintah lokal ini membuat password acak berbeda untuk setiap admin dan menampilkannya sekali di terminal. Simpan secara privat. Menjalankan ulang tidak mengganti password yang sudah ada. Nomor admin dan password tidak ditulis ke repository. Administrator yang dinonaktifkan tidak diaktifkan kembali secara otomatis.

## Impor Excel privat

Simpan workbook di folder `private/` pada komputer operator. Folder ini dikecualikan dari Git.

`npm run catalog:import-xlsx -- "private/produk.xlsx"`

Perintah tersebut hanya memeriksa file dan menampilkan jumlah produk/varian. Untuk menerapkan:

`npm run catalog:import-xlsx -- "private/produk.xlsx" --apply`

Format workbook: header Nama Item, Varian, Harga pada kolom C, D, F di worksheet pertama. Nama produk yang kosong mengikuti produk sebelumnya; nama produk berulang digabung. Biaya produksi, margin, komentar, dan referensi seller tidak disimpan di database aplikasi. File asli tetap menjadi sumber internal untuk informasi tersebut.

Impor menambahkan atau memperbarui produk berdasarkan slug. Nomor katalog lama dipertahankan, produk baru mendapatkan nomor berikutnya. Harga dan nama varian mengikuti workbook. Produk masuk sebagai draf, varian nonaktif dan stok habis; impor ulang juga mengembalikannya ke draf. Deskripsi/ketentuan yang telah diisi dipertahankan. Varian lama yang tidak tercantum diarsipkan, bukan dihapus. Produk yang sama sekali tidak ada dalam file tetap dipertahankan. Tidak ada durasi garansi yang ditebak dari nama paket; aturan YouTube yang telah disepakati dipertahankan.

## Dashboard

Jalankan `npm start`, buka `http://localhost:3000/admin`, lalu masuk memakai nomor admin dan password dari langkah setup. Kredensial tidak disimpan di localStorage/cookie. Tombol Keluar menghapus kredensial dari memori halaman.

Tersedia daftar produk, tambah, edit nama/deskripsi/ketentuan, tambah/edit/nonaktifkan varian, harga, stok, durasi garansi internal, label garansi pelanggan, kebutuhan email, publikasi, dan arsip produk. Slug produk yang sudah disimpan tidak dapat diubah. Publikasi memerlukan deskripsi, ketentuan, minimal satu varian aktif, dan label garansi setiap varian aktif. Isi label Tanpa garansi dan durasi 0 hanya jika memang kebijakan produk demikian.

Untuk akses di luar komputer lokal, deploy dengan HTTPS dan set `ADMIN_PUBLIC_ORIGIN=https://domain-anda` tanpa trailing slash. Reverse proxy harus memblokir akses HTTP langsung ke backend. Jangan membuka port HTTP backend ke internet. Sesuaikan PORT bila tidak menggunakan 3000.

## WhatsApp

Jalankan `npm run wa:start` di terminal lain. Dari nomor admin terdaftar kirim `/admin help`. Perintah admin hanya diterima melalui chat pribadi dengan identitas nomor yang tersedia. LID tanpa pemetaan nomor tidak diberikan akses admin.

Contoh menggunakan produk fiktif:

```text
/admin tambah contoh | Produk Contoh
/admin deskripsi contoh | Deskripsi produk
/admin ketentuan contoh | Ketentuan penjualan
/admin varian contoh | Paket Basic | 10000
/admin lihat contoh
/admin ubah-varian contoh | ID_VARIAN | Paket Basic | 10000 | out | 0 | Tanpa garansi | false | true
/admin publikasi contoh
/admin arsip contoh
```

`/admin list` melihat seluruh produk. `/admin hapus-varian contoh | ID_VARIAN` menonaktifkan varian. Arsip produk menyembunyikannya dari katalog pembeli dan mempertahankan seluruh riwayat order. Perubahan dicatat dengan aktor dan waktu. Jika muncul konflik perubahan admin, muat ulang lalu edit lagi.

Katalog hanya menampilkan label garansi kepada pelanggan, bukan jumlah hari internal. Pembayaran WhatsApp masih belum diaktifkan pada tahap ini.
