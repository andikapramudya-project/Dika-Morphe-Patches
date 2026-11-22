# Pengujian perangkat 0.8.0-trial.5

Dokumen ini memisahkan hasil yang sudah teramati pada Poco X7 dari checklist yang masih perlu diverifikasi. Pengiriman absensi ke server tetap ditahan; hasil di bawah hanya mengonfirmasi penyimpanan lokal.

## Hasil perangkat — 8 November 2026

Semua waktu menggunakan **WITA (UTC+8)**. Perangkat menjalankan Android 16 / HyperOS 3.0 dan GreatDay 1.79.1 build 22725. Proses GreatDay masih hidup (**PID 31428**), perangkat terhubung USB dan sedang mengisi daya, serta `deviceidle` menunjukkan **ACTIVE**.

| Skenario | Kondisi awal | Pemicu native | Konfirmasi tersimpan | Perubahan antrean |
| --- | --- | --- | --- | --- |
| Aplikasi diminimalkan | Tombol Home pada 06:45:49; jadwal 06:48 | 06:48:25.658 | 06:48:26.020, ID `mw6zvo28` | 3 → 4 |
| Layar mati, uji pertama | Layar mati sejak 06:49:02; jadwal 06:51 | 06:52:29.913 | 06:52:30.340, ID `mw700wjv` | 4 → 5 |
| Layar mati, ulang tanpa probe | Layar mati sejak 06:53:37; jadwal 06:55 | 06:56:23.248 | 06:56:23.665, ID `mw705wl7` | 5 → 6 |

Pada uji diminimalkan, penyimpanan terjadi sebelum pemeriksaan CDP pertama pukul 06:48:47. Pada uji layar mati pertama, ada pemeriksaan CDP pukul 06:51:35, sebelum alarm yang baru tiba sekitar 90 detik setelah jadwal. Karena itu, dilakukan uji ulang tanpa pemeriksaan CDP selama jendela jadwal.

Pada uji ulang 06:55, tidak ada probe CDP dari konfigurasi 06:53:09 sampai pemeriksaan pertama 06:56:45.617. Layar mati dikonfirmasi melalui ADB sejak 06:53:37 hingga observasi 06:56:36. Catatan berwaktu aktual 06:56:23.416 telah tersimpan sebelum probe pertama. Setelah layar dibangunkan, status pukul 06:56:56.235 tetap menunjukkan visibility tersembunyi di balik keyguard dan antrean tetap 6. Resume GreatDay ke foreground dan restart penuh belum diuji pada build ini.

Bukti dan batasan rinci tersedia pada laporan hasil perangkat.

## Batas hasil yang sudah diamati

- Tiga catatan baru ditemukan pada antrean asli GreatDay dalam kondisi proses masih hidup. Ini belum membuktikan pencatatan setelah proses dimatikan atau Force stop.
- Perangkat sedang mengisi daya dan `deviceidle=ACTIVE`; hasil ini bukan pengujian Doze mendalam atau layar mati semalaman.
- Alarm dapat terlambat; waktu aktual pencatatan tidak dipundurkan ke jam jadwal. Uji pertama layar mati menunjukkan keterlambatan sekitar 90 detik.
- Pengamatan CDP dapat memengaruhi keadaan WebView. Uji ulang terakhir menunda probe hingga setelah waktu penyimpanan, sehingga hasil layar mati tidak bergantung pada probe selama jendela jadwal.
- Penerimaan server tidak diuji. Build uji harus tetap menahan pengiriman dan catatan asli tidak dihapus oleh reset maupun pembersihan riwayat.

## Checklist pemasangan dan fungsi dasar

- Impor bundle ke Morphe; pastikan empat pilihan muncul dan dua pilihan pertama dipilih secara default.
- Terapkan ke APK acuan yang cocok dengan enam fingerprint. Pertahankan data akun dan penandatanganan pembaruan.
- Pastikan izin mode offline perusahaan, pengaturan GreatDay `takePhoto=false`, layanan lokasi aktif, dan koordinat aktual tersedia.
- Periksa banner build uji, pengiriman tertahan, serta tidak tersedianya tombol Kirim sekarang.
- Periksa floating Jadwal orange dan keterbacaan panel pada tema terang/gelap. Warna global Morphe tetap mengikuti Morphe.
- Profil baru memakai 07:30 / 19:30 WITA; profil lama harus mempertahankan waktu dan hari yang tersimpan.
- Uji Bersihkan riwayat: hanya log panel hilang, pengunci dan antrean tetap tersimpan.
- Uji Reset masuk/pulang dengan konfirmasi: hanya pengunci jenis absen hari WITA saat ini dibuka. Catatan asli tetap ada.
- Periksa riwayat bergulir 50 kejadian, termasuk setelah memuat riwayat lama dan membuka ulang aplikasi.

## Checklist pencatatan dan pencegahan duplikat

- Pilih waktu uji beberapa menit setelah build siap; jangan mengubah waktu ponsel.
- Catat antrean awal dan reservasi sebelum uji. Matikan Wi-Fi serta data seluler untuk uji offline, dengan lokasi tetap aktif.
- Simpan jadwal dan aktifkan layanan lokasi uji ketika aplikasi masih terlihat; setelah itu minimalkan atau matikan layar sesuai skenario.
- Selama jendela observasi, jangan membuka aplikasi, mengetuk notifikasi, atau mengirim evaluasi CDP. Ambil bukti pasif ADB bila diperlukan.
- Setelah jendela berakhir, bandingkan waktu callback, riwayat konfirmasi penyimpanan, ID baru, dan isi antrean asli. Notifikasi saja tidak membuktikan pencatatan.
- Buka/resume aplikasi setelah berhasil: tidak boleh muncul catatan kedua untuk percobaan yang sama.
- Hasil yang belum pasti tidak dicoba ulang otomatis. Periksa antrean sebelum menggunakan reset.
- Di luar toleransi 15 menit atau pada hari nonaktif: jadwal yang belum dicoba tidak boleh diproses.
- Mode normal/final harus mengunci satu masuk dan satu pulang per akun per tanggal WITA meskipun jam diubah. Kunci per jam dan reset hanya berlaku pada build uji.
- Tanpa lokasi, koordinat valid, atau pengaturan perusahaan yang sesuai: jangan tampilkan berhasil tersimpan.
- Pergantian akun tidak boleh mewarisi jadwal aktif atau menampilkan catatan akun sebelumnya.

## Penutupan pengujian yang sudah diverifikasi

Jadwal uji sudah dinonaktifkan dan dikembalikan ke 07:30 / 19:30 WITA, Senin–Jumat. Alarm milik patch 0, keeper tidak aktif, listener sementara BackgroundFetch dilepas, dan runner tidak lagi terinisialisasi. Wi-Fi dipulihkan aktif; data seluler tetap nonaktif. Antrean setelah uji ulang dan pembacaan status sesudah layar dibangunkan berisi 6 catatan. Pada 06:58:17.672, penahanan pengiriman juga diverifikasi saat GreatDay mendeteksi online: hardHeld true, confirmSend false, dan keenam ID tetap sama setelah pemanggilan layanan sinkronisasi asli berhenti pada guard. Layanan native penjaga proses tidak berjalan, forward debug 9222 sudah dihapus, dan port 5005 tidak terdaftar.

Memulihkan internet tidak membuka pengiriman selama build uji ini tetap terpasang. Memasang build lain yang tidak menahan sinkronisasi dapat membuat GreatDay memproses antrean yang tertinggal. Jangan membagikan token autentikasi, koordinat, atau informasi akun dalam laporan publik.
