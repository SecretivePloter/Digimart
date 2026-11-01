// Keterangan operasional singkat; harga dan pilihan varian selalu berasal dari database.
export const catalogCopy: Record<string, string[]> = {
  youtube: ['Aktivasi menggunakan akun Gmail pembeli.'],
  netflix: ['Akun sharing; login dengan email dan password, atau cookie jika tersedia.', 'Bebas pilih profil; gunakan sesuai jumlah perangkat pada varian.', 'Anti limit screen.', 'Garansi selama masa aktif, maksimal 23 hari.'],
  capcut: ['Akun diberikan penjual.', 'Bisa digunakan di HP, PC, dan laptop.'],
  canva: ['Akun diberikan penjual.', 'Jika akses bermasalah dalam 1×24 jam setelah diterima, hubungi admin.'],
  iqiyi: ['Pilihan sharing atau private sesuai varian.', 'Jangan mengubah data akun atau keluar dari akun tanpa konfirmasi admin.', 'Garansi mengikuti ketentuan varian; tidak berlaku bila akun ditangguhkan akibat pelanggaran pembeli.'],
  hbo: ['Pilihan sharing atau private sesuai varian.', 'Jumlah perangkat dan akses mengikuti varian yang dipilih.'],
  strava: ['Akun private untuk penggunaan pribadi.', 'Data detak jantung dan power memerlukan perangkat atau sensor yang mendukung.'],
  'gemini-ai': ['Aktivasi lewat undangan ke Gmail pembeli; tidak perlu memberikan kata sandi.', 'Paket Invite dan Head mengikuti varian yang dipilih.', 'Jika ada kendala akses, hubungi admin dengan nomor pesanan.'],
  'quillbot-pharaprase': ['Akun Premium sharing.', 'Detail akses diberikan setelah pesanan diproses.'],
  disney: ['Varian 6u, 3u, dan private memiliki ketentuan penggunaan berbeda.', 'Gunakan sesuai jumlah pengguna pada paket yang dipilih.'],
  'paket-xl': ['Paket Akrab XL berlaku 1 bulan.', 'Hubungi admin untuk detail kuota dan aktivasi sebelum membeli.'],
  'zoom-meeting': ['Akses Premium sesuai durasi varian.', 'Detail akun diberikan setelah pesanan diproses.'],
  lightroom: ['Akses Premium 1 tahun; label varian mencantumkan garansi 1 bulan.', 'Detail aktivasi diberikan setelah pesanan diproses.'],
  scribd: ['Akses Premium 1 bulan.', 'Detail akun diberikan setelah pesanan diproses.'],
  'microsoft-365': ['Akses Plus 1 tahun; label varian mencantumkan garansi penuh.', 'Detail aktivasi diberikan setelah pesanan diproses.'],
  'apple-music': ['Pilihan Family atau Head untuk 1 bulan.', 'Detail aktivasi diberikan setelah pesanan diproses.'],
  'duolingo-super': ['Akun private; durasi dan garansi mengikuti varian.', 'Detail akun diberikan setelah pesanan diproses.'],
  'unlock-imei': ['Pilihan Fast 1 bulan atau Semi Fast 3 bulan.', 'Hubungi admin untuk syarat perangkat dan proses sebelum membeli.'],
  'followers-ig': ['Jumlah dan jenis pengikut mengikuti varian.', 'Siapkan username Instagram yang benar untuk pemrosesan.'],
  'robux-roblox-via-username': ['Robux dikirim melalui username Roblox.', 'Periksa username dan jumlah Robux sebelum memesan.'],
};

export const priceChanges: Record<string, Record<string, number>> = {
  youtube: { 'Family head gmail buyer': 19000 },
  capcut: { '1 Bulan': 34000 },
  canva: { 'Pro Life Time': 30000 },
};
