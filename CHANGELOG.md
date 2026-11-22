# 0.9.0-trial.1

- Menambahkan extension DEX native untuk alarm exact 07:00/19:00 WITA, receiver alarm/boot, foreground service lokasi, dan konfigurasi/reservasi persisten.
- Menambahkan penyimpanan lokasi sementara terpisah dari GreatDay dan hook masuk/pulang `NOT_IMPLEMENTED`; penahanan seluruh pengiriman offline tetap wajib.
- Menambahkan bridge WebMessagePort origin lokal, panel status native, dan layar izin. Jalur pencatatan otomatis/keeper trial.5 tidak dipakai pada mode native.
- Melindungi dari duplikasi harian, akun berubah, GPS/izin kurang, fix usang/tidak akurat/mock, dan callback setelah timeout.
- Menghapus batas API 33 pada izin exact alarm sumber. Menambahkan build Java/D8 dan tes native/MessagePort/browser.

Dua uji Poco X7 berhasil: swipe/proses mati dengan layar mati pada 19:34 dan setelah reboot/unlock tanpa membuka GreatDay pada 19:39 WITA. Hasil hanya dummy; antrean GreatDay tetap 8, pengiriman ditahan, jadwal akhir 07:00/19:00 Senin–Jumat nonaktif. Laporan perangkat dan [panduan](docs/NATIVE-TRIAL.md). Doze mendalam/semalaman belum diuji.

# 0.8.0-trial.5

- Menambahkan fallback ISO waktu perangkat aktual hanya untuk wake offline milik runner dengan proses aktif, controller/machine yang sama, serta identitas akun yang tetap cocok.
- Pemeriksaan waktu otomatis asli tetap dijalankan di hulu. Alur online dan pemanggilan waktu biasa tetap mengikuti GreatDay.
- Menargetkan hambatan hasil trace trial.4: pemeriksaan izin/lokasi/keamanan/waktu otomatis selesai tetapi permintaan waktu server dan timeout RxJS tertunda selama aplikasi tersembunyi.
- Mempertahankan alias lokasi, dispatch native khusus tugas uji, legacy bridge, enam fingerprint, riwayat/reset, dan penahanan seluruh pengiriman offline.

66 tes Node, pengujian browser kode saat ini (empat skenario, 16 kombinasi fitur, dua tema dengan kontras minimal 4,5:1, dua ukuran layout), enam fingerprint/fungsi asli terisolasi, dan build MPP lulus. Pada Poco X7, satu catatan tersimpan saat diminimalkan (06:48:26.020 WITA, antrean 3 → 4) dan satu pada uji layar mati pertama (06:52:30.340, antrean 4 → 5). Hasil terbatas pada proses masih hidup, USB mengisi daya, dan deviceidle ACTIVE. Uji ulang layar mati tanpa probe selama jadwal menyimpan catatan ketiga pada 06:56:23.665 WITA, sebelum probe pertama 06:56:45.617, sehingga antrean menjadi 6. Penahanan saat online diverifikasi dan jadwal/alarm/keeper/listener uji dihentikan. Foreground resume/restart penuh, Doze mendalam, proses yang dimatikan, dan penerimaan server belum diuji.

# 0.8.0-trial.4

- Mempertahankan alat uji, riwayat 50 kejadian, reset terpisah dari catatan asli, tombol Jadwal orange, dan penahanan seluruh pengiriman offline.
- Mempertahankan alias native plugin lokasi komunitas `DikaBackgroundGeolocation` dengan nilai anotasi asli tetap utuh; plugin Transistorsoft tidak diganti.
- Menambahkan dispatch `BackgroundFetch.doFetch` khusus tugas `dika-trial-offline-*` yang masih memiliki konfigurasi dan callback terdaftar. ID asli diteruskan ke callback; tugas lain kembali ke metode asli tanpa mengubah flag lifecycle SDK.
- Mengaktifkan `android.useLegacyBridge=true` khusus build uji dan memeriksa enam fingerprint resource, termasuk konfigurasi Capacitor.

Baseline validasi build uji sebelumnya: 65 tes Node, pengujian browser, verifikasi aset/deklarasi patch, dan build MPP. Hasil akhir build ini menunggu laporan perangkat. Pada Poco X7, pemicu native telah teramati tetapi alur pencatatan mengalami timeout pada uji latar belakang yang lebih panjang; keberhasilan pencatatan tanpa membuka aplikasi belum dibuktikan.

# 0.8.0-trial.1

- Build khusus uji: pengiriman offline ditahan pada pintu sinkronisasi APK, termasuk jika runtime tidak tersedia, fitur konfirmasi tidak dipilih, atau persetujuan lama tersimpan.
- Riwayat bergulir 50 kejadian dan tombol Bersihkan riwayat, terpisah dari pengunci absensi dan antrean asli.
- Reset percobaan masuk/pulang hari WITA saat ini dengan konfirmasi, hanya pada build uji dan di luar proses aktif.
- Mode normal/final mengunci satu masuk/pulang per tanggal meskipun jam diubah, termasuk reservasi format lama.
- Floating Jadwal kembali menggunakan orange GreatDay dengan kontras teks yang disesuaikan.
- Prototipe warm-background melalui BackgroundFetch bawaan dan penyimpanan asli tanpa halaman preview; tidak mendukung proses yang dimatikan atau Force stop.
- Debug WebView khusus build uji untuk observasi ADB.

Validasi awal: 58 tes Node, pengujian browser, fingerprint/transformasi APK, dan build MPP. Hasil perangkat Poco X7 dicatat terpisah bersama artefak build.

# 0.7.1-experimental

- Perbaikan uji ulang pada hari yang sama: reservasi memakai tanggal, jenis absen, dan jam jadwal. Mengubah 04:30 menjadi 04:35 membuat jadwal baru; menyimpan ulang, resume/restart, atau kembali ke jam yang sudah dicoba tidak menggandakan pencatatan.
- Reservasi 0.7.0 tetap berlaku untuk jam aslinya. Data lama tanpa informasi jam tetap diblokir untuk mencegah percobaan dengan hasil tidak pasti.
- Perubahan jadwal ditolak selama proses absensi masih berlangsung.
- Status masuk/pulang mengikuti jam yang sedang dikonfigurasi. Riwayat lama tidak menjadi status jadwal baru. Catatan yang keluar dari antrean tidak diklaim diterima server.
- Riwayat dan ekspor diagnosis menyertakan jam jadwal serta status masing-masing slot.
- Kontras teks panel diperbaiki; warna teks tombol dihitung dari warna latar. Warna global Morphe dan GreatDay tidak diubah.

Validasi lokal: 39 tes Node; empat skenario browser termasuk perubahan jam saat jaringan browser dimatikan; 16 kombinasi fitur; kontras teks minimal 4,5:1 pada fixture terang/gelap; dua ukuran layout; fingerprint lima aset dan sintaks transformasi; fungsi lokasi dan penyimpanan asli terisolasi; verifikasi empat pilihan patch dan build Android MPP.

Pencatatan tetap memerlukan GreatDay aktif dalam toleransi 15 menit. Belum diuji pada perangkat atau server GreatDay; pengujian tidak mengirim absensi.

# 0.7.0-experimental

- Otomatisasi lokasi tanpa kamera mengikuti pengaturan GreatDay takePhoto=false, saat online maupun offline.
- Lokasi diminta melalui fungsi asli tanpa mengubah status jaringan atau koordinat.
- Pemrosesan jadwal terlewat sampai 15 menit ketika aplikasi aktif; timestamp tetap waktu aktual.
- Kesiapan layanan dan overlay tidak lagi menghabiskan slot sebelum pencatatan dimulai.
- Recorder diperiksa kembali saat polling/resume.
- Hasil penyimpanan yang belum pasti tidak dicoba ulang otomatis; ID yang ditemukan di antrean asli dapat direkonsiliasi.
- Penyimpanan offline tidak menunggu permintaan tombol online; handler asli offline diverifikasi dengan layanan uji.
- Panel membaca antrean asli GreatDay, terpisah dari konfirmasi pengiriman.
- Default profil baru 07:30 / 19:30 WITA; pengaturan tersimpan dipertahankan.
- Tentang dihapus; panel dan notifikasi diringkas; riwayat rinci serta ekspor hanya pada pilihan Diagnostik.
- Empat pilihan Morphe: Absen terjadwal, Pengingat absen, Konfirmasi sebelum kirim, Diagnostik; satu dependensi integrasi tersembunyi.
- Konfirmasi kirim dan diagnostik tidak dipilih secara default. Tanpa konfirmasi kirim, sinkronisasi mengikuti GreatDay asli.

Validasi lokal: 34 tes Node; empat skenario browser; 16 kombinasi pilihan; dua ukuran layout; fingerprint lima aset dan sintaks hasil transformasi; fungsi lokasi asli terisolasi dengan layanan sintetis; empat deklarasi patch hasil kompilasi; build Android MPP.

Belum diverifikasi pada ponsel atau server GreatDay. Tidak ada APK dipasang atau absensi dikirim dalam pengujian ini.
