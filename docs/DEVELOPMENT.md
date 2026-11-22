# Pengembangan

**Aktif: 0.9.0-trial.1.** Build sekarang memerlukan Android SDK platform 36/build-tools 36.0.0 untuk extension native. Lihat [panduan native](NATIVE-TRIAL.md) untuk build MPP, Robolectric API 36, verifikasi APK, dan hook dummy. Bagian trial.5 di bawah adalah riwayat jalur hangat; jalur tersebut tidak menjalankan pencatatan otomatis dalam mode native.

Prasyarat: Node.js, Python, Java 21, Gradle 9.8.2, dan Playwright untuk tes browser.

    node --test tests/*.test.cjs
    python scripts/check_target.py /path/to/GreatDay-original.apk
    node tests/browser-smoke.cjs
    gradle :patches:verifyPatchChoices :patches:buildAndroid --no-daemon

BROWSER_EXECUTABLE dapat menunjuk Chrome/Chromium lokal. Tes browser memakai layanan sintetis. Pemeriksaan APK memvalidasi fingerprint enam aset, anchor, sintaks transformasi, serta potongan fungsi lokasi/kamera dan penyimpanan offline dengan layanan tiruan. Pemeriksaan statis ini tidak menjalankan APK.

Build memakai app.morphe.patches 2.1.0 dan Morphe Patcher 2.2.0. Konfigurasikan kredensial GitHub Packages di luar repositori. Output tersedia di patches/build/libs/.

## Build uji 0.8.0-trial.5

Mode uji dikendalikan oleh konstanta kompilasi `TRIAL_BUILD` pada `OfflineSchedulePatch.kt`. Pada mode ini, pintu sinkronisasi offline APK mengembalikan hasil sebelum alur pengiriman asli dijalankan, termasuk ketika runtime JavaScript tidak tersedia. Persetujuan lama dan pilihan patch tidak membuka pengiriman. Fitur reset dibatasi untuk pengujian; membersihkan riwayat tidak menghapus pengunci atau catatan GreatDay.

Perubahan native khusus mode uji:

- Anotasi plugin lokasi komunitas diberi nama `DikaBackgroundGeolocation`. Nilai permission, request code, dan visibility aslinya dipertahankan. Plugin Transistorsoft tetap memakai nama/configuration aslinya.
- Dispatch `BackgroundFetch.doFetch(BGTask)` mendapat cabang awal untuk ID berawalan `dika-trial-offline-` saja. Tugas harus masih memiliki konfigurasi dan callback yang terdaftar. Cabang tersebut memanggil `Callback.onFetch()` dengan ID asli; jika salah satu syarat tidak terpenuhi, eksekusi kembali ke instruksi pertama metode asli. Flag headless/background SDK tidak dimodifikasi.
- `assets/capacitor.config.json` masuk ke daftar fingerprint. Setelah verifikasi, mode uji menambahkan `android.useLegacyBridge=true` untuk meneliti jalur pengiriman callback ke WebView ketika aplikasi tersembunyi.
- `android:debuggable=true` digunakan untuk observasi ADB/WebView pada APK uji. Build ini tidak ditujukan sebagai build produksi.

Perubahan waktu offline khusus build `0.8.0-trial.5`:

- `Runner.useOfflineDeviceTime(machine)` hanya mengizinkan fallback ketika runner memiliki wake aktif, proses pencatatan masih aktif, controller menggunakan instance machine yang sama, identitas akun tidak berubah, dan `machine.networkService.isOffline === true`.
- Hook pada `getCurrentTime()` mengembalikan ISO waktu perangkat aktual pada kondisi terbatas tersebut. Alur online, pemanggilan biasa, dan tugas yang tidak dimiliki runner menggunakan implementasi asli.
- Pemeriksaan `checkAutoTime` asli tetap berada di hulu alur pencatatan. Hook tidak mengubah waktu perangkat, memilih waktu jadwal yang sudah lewat, atau menyatakan waktu server berhasil diperoleh.
- Tujuan perubahan adalah memilih lebih awal fallback waktu perangkat yang sudah tersedia pada alur asli ketika permintaan waktu gagal. Trace perangkat menunjukkan timer timeout RxJS pada halaman tersembunyi dapat tertunda sampai aplikasi kembali ke depan.

Pemeriksaan deklarasi DEX memvalidasi class, anotasi, signature metode, callback interface, dan register sebelum penyisipan. Perubahan ini tidak menghapus pemeriksaan lokasi, waktu, foto, atau validasi absensi GreatDay.

## Validasi lokal dan batas bukti

Validasi kode dan artefak build `0.8.0-trial.5` yang telah lulus:

- 66 tes Node, termasuk pembatasan fallback waktu offline.
- Empat skenario browser, perubahan jam dengan jaringan browser dimatikan, seluruh 16 kombinasi fitur, dialog konfirmasi reset/bersihkan riwayat, dua tema dengan kontras teks minimal 4,5:1, dan dua ukuran layout.
- Enam fingerprint resource, anchor, sintaks transformasi, serta fungsi lokasi, penyimpanan, dan fallback waktu perangkat asli yang diisolasi.
- Empat deklarasi patch yang dapat dipilih, dependensi integrasi/alias native tersembunyi, dan build Android MPP.

Jumlah enam aset mencakup empat chunk JavaScript, `assets/public/index.html`, dan `assets/capacitor.config.json`. Pemeriksaan fingerprint resource dan kompilasi bundle tidak membuktikan keberhasilan eksekusi callback atau pencatatan pada perangkat. Verifikasi artefak APK diperlukan untuk memastikan hasil modifikasi DEX serta konfigurasi yang benar-benar dipasang.

Trace `device-trace-result.json` dari artefak `0.8.0-trial.4` pada Poco X7 menunjukkan pemicu native tiba sekitar 06:42:25 WITA. Pemeriksaan izin, GPS, keamanan, lokasi aktual, kamera nonaktif, dan waktu otomatis selesai; pemanggilan `getCurrentTime()` kemudian tidak selesai selama aplikasi tersembunyi. Perubahan build `0.8.0-trial.5` menargetkan hambatan ini. Pada uji perangkat berikutnya, antrean asli bertambah 3 → 4 ketika aplikasi diminimalkan (ID `mw6zvo28`, tersimpan 06:48:26.020 WITA), lalu 4 → 5 pada uji layar mati pertama (ID `mw700wjv`, tersimpan 06:52:30.340 WITA).

Uji ulang layar mati 06:55 mengonfirmasi catatan `mw705wl7` tersimpan 06:56:23.665 WITA, setelah callback native 06:56:23.248, sebelum probe CDP pertama 06:56:45.617; antrean bertambah 5 → 6. Tidak ada probe CDP dari konfigurasi 06:53:09 sampai pemeriksaan tersebut. Hasil perangkat berlaku untuk proses masih hidup (PID 31428), USB tersambung/mengisi daya, dan `deviceidle=ACTIVE`. Penahanan pengiriman terverifikasi saat offline dan setelah Wi-Fi online; jadwal/alarm/keeper/listener uji sudah dihentikan. Setelah layar dibangunkan, keyguard tetap mengunci dan visibility tersembunyi; resume foreground serta restart penuh belum diuji. Hasil ini belum mencakup Doze mendalam, semalaman tanpa pengisian, proses yang dihentikan, atau Force stop. Lihat laporan hasil Poco X7.

SHA-256 APK target: 7cfd49f18faff80c235a7e359b8c47cc86d0f08c502890b090f1431dfa6bea71.

Koordinat kosong, tidak valid, dan fallback bertanda cache tidak disimpan otomatis. Pengaturan perusahaan, lokasi, waktu, jaringan, dan hasil validasi tidak dipalsukan. Hasil pencatatan yang belum pasti tidak dicoba ulang otomatis; record yang ditemukan di antrean asli dapat direkonsiliasi berdasarkan ID.

Untuk pengujian perangkat, bedakan alarm terjadwal, callback native, callback JavaScript, pengambilan lokasi, penyimpanan lokal, dan penerimaan server. Catat waktu aktual setiap tahap serta keadaan aplikasi. Proses/WebView harus masih hidup untuk prototipe ini; proses yang dihentikan dan Force stop belum didukung. Ikuti [checklist perangkat](DEVICE_TESTS.md) dan catatan batasan build uji.

## Publikasi

Perbarui gradle.properties, CHANGELOG.md, patches-bundle.json, tautan unduhan README, dan docs/releases/<version>.md bersama-sama. Push tag v<version> memicu pengujian, build, dan penerbitan rilis beserta .mpp dan checksum. Workflow memeriksa kesesuaian tag, versi, dan metadata sebelum publikasi.
