# Uji native 0.9.0-trial.1

Tahap ini menguji alarm, notifikasi, dan penyimpanan lokasi sementara. **Belum mencatat ke antrean GreatDay.** Hook GreatDay mengembalikan `NOT_IMPLEMENTED`; pintu pengiriman offline GreatDay tetap ditahan pada resource APK, termasuk ketika runtime JavaScript tidak tersedia.

## Aktivasi

1. Patch APK acuan GreatDay 8 1.79.1 / 22725 yang cocok dengan enam fingerprint. Impor bundle lokal melalui Morphe, lalu pasang hasil patch lewat alur pembaruan yang mempertahankan data.
2. Buka GreatDay dan login. Panel **Jadwal** menampilkan **Uji jadwal native**. Preferensi Android native menjadi sumber konfigurasi; preferensi aktif trial.5 tidak otomatis diaktifkan kembali.
3. Default tahap ini: **07:00 masuk, 19:00 pulang, WITA / Asia/Makassar, Senin–Jumat**, dalam keadaan **nonaktif**. Jam/hari bisa diubah untuk pengujian.
4. Gunakan **Periksa izin native** untuk mengizinkan Alarm & pengingat, notifikasi, lokasi presisi, dan lokasi sepanjang waktu. Aktifkan GPS dan tanggal/waktu otomatis. Untuk lokasi sepanjang waktu, buka Info aplikasi → Izin → Lokasi → Izinkan sepanjang waktu. Penolakan izin tidak diakali.
5. Di Poco X7, aktifkan Autostart dan Battery saver: No restrictions pada **GreatDay hasil patch**. Aktifkan jadwal, simpan, lalu periksa waktu alarm berikutnya pada panel.

Jika izin alarm/notifikasi kurang, penyimpanan jadwal aktif ditolak. Jika GPS atau izin lokasi kurang ketika alarm tiba, catat status perlu perhatian dan tampilkan peringatan jika notifikasi diizinkan. Tidak ada layanan lokasi yang dipaksa berjalan dengan prasyarat yang tidak terpenuhi. Tidak ada pengulangan otomatis setelah pengguna mengaktifkan GPS; percobaan slot itu tetap terkunci untuk diperiksa.

## Alur native

`AlarmManager → AttendanceAlarmReceiver → AttendanceForegroundService → lokasi GPS aktual → simpanAbsenLokal → hook dummy GreatDay`

- Dua `PendingIntent` eksplisit dan immutable, memakai `RTC_WAKEUP` + `setExactAndAllowWhileIdle`. Tidak memakai alarm berulang/inexact atau timer WebView untuk pemicu utama.
- `BootReceiver` hanya mendaftarkan ulang alarm. Pemulihan mencakup `BOOT_COMPLETED`, pembaruan paket, perubahan waktu/zona, dan pemberian izin exact alarm. Data credential-encrypted tersedia setelah unlock pertama; tahap ini tidak mendukung sebelum unlock pertama.
- Provider privat memasang bridge `WebMessagePort` ketika Activity GreatDay terlihat. Port dikirim hanya ke origin lokal Capacitor `https://localhost`/`http://localhost`, tanpa wildcard, tanpa `addJavascriptInterface`, tanpa mengganti WebViewClient GreatDay. Receiver dan service tidak memerlukan Activity/WebView.
- Pilihan fitur dibaca dari aset patch oleh native juga ketika cold start. Pilihan Pengingat saja tidak mengambil lokasi. Bila kedua fitur jadwal tidak dipilih, alarm lama dibatalkan saat rekonsiliasi dan receiver tidak bekerja.
- Service `exported=false`, `stopWithTask=false`, tipe `location`, bersifat singkat dan `START_NOT_STICKY`. Notifikasi foreground segera ditampilkan sebelum pengambilan lokasi; partial wake lock dibatasi 60 detik, timeout lokasi 45 detik, listener dan lock dilepas ketika selesai/dibatalkan.
- Lokasi terakhir GPS hanya diterima jika umur elapsed realtime maksimal 120 detik, akurasi maksimal 100 meter, koordinat valid/nonkosong, dan bukan lokasi mock. Jika cache tidak memenuhi syarat, minta fix GPS baru. Tidak ada fallback koordinat tetap.
- Timestamp penyimpanan memakai waktu aktual ketika fix diterima. Waktu pemicu jadwal disimpan terpisah. Hasil bukan bukti geofence atau validasi absensi GreatDay.
- Reservasi persisten dibuat sebelum efek samping: hash akun + tanggal WITA + masuk/pulang. Perubahan jam, reboot, dan pengiriman ulang broadcast tidak membuka percobaan kedua. Hasil terputus/tidak pasti tidak diulang otomatis. Tidak ada tombol reset native dalam tahap ini.
- Jika alarm yang sudah terdaftar baru dipulihkan dalam toleransi 15 menit dan slot belum direservasi, pemicu dapat diproses dengan waktu aktual. Di luar toleransi tidak dibuat catatan untuk waktu yang sudah lewat.

## Penyimpanan dan hook

Kode native berada di `native-runtime/src/main/java/app/dika/greatday/nativebridge/`.

- `AttendanceForegroundService.simpanAbsenLokal(double lat, double lon, long timestamp)` menyimpan hasil pada SharedPreferences privat `dika_native_trial_v1`, **bukan** database GreatDay. Catatan dan status terminal disimpan dalam satu commit. Maksimal 50 hasil lokasi dan 50 kejadian; reservasi harian tetap dipertahankan.
- `GreatDayOfflineHook.invokeGreatDayOfflineClockIn(double lat, double lon, long timestamp)` adalah template masuk.
- `invokeGreatDayOfflineClockOut(...)` dan `invokeGreatDayOfflineAttendance(Kind, ...)` membedakan pulang dari masuk.
- Semua hook mengembalikan `NOT_IMPLEMENTED`. Tidak ada reflection, akses DAO GreatDay, atau panggilan jaringan. Notifikasi dan panel memakai istilah **lokasi sementara**, tidak mengklaim absensi GreatDay tersimpan.
- Menambahkan DAO nanti memerlukan verifikasi identitas native, bentuk payload, validasi perusahaan/foto/lokasi/waktu, transaksi, ID record, dan semua jalur pengiriman. Tiga parameter saja belum merupakan kontrak penyimpanan GreatDay yang terverifikasi.
- Ekspor diagnosis tidak menyertakan koordinat atau identitas akun native. Koordinat hanya berada dalam penyimpanan privat patch di perangkat.

## Build dan verifikasi

Prasyarat tambahan: Android SDK platform 36, build-tools 36.0.0. Tetapkan `ANDROID_HOME` atau `ANDROID_SDK_ROOT` (atau `sdk.dir` di `local.properties` lokal). Runtime hanya menggunakan API yang sesuai Android 8 / API 26 ke atas; manifest mempertahankan minSdk minimal 26 dan target SDK aplikasi. Batas `maxSdkVersion=33` pada izin exact alarm APK acuan dihapus agar izin bisa diberikan pada Android 14+.

```sh
sdkmanager "platforms;android-36" "build-tools;36.0.0"
node --test tests/*.test.cjs
node tests/browser-smoke.cjs
node tests/native-browser.cjs
gradle -p native-runtime testDebugUnitTest lintDebug --no-daemon
gradle :patches:testNativePlan :patches:verifyPatchChoices :patches:buildAndroid --no-daemon
python scripts/check_target.py /path/to/GreatDay-original.apk
gradle :patches:verifyNativeTarget -PtargetApk=/path/to/GreatDay-original.apk --no-daemon
python scripts/check_native_artifacts.py patches/build/libs/patches-0.9.0-trial.1.mpp --apk patches/build/native-target-check/greatday-native-trial-unsigned.apk --aapt2 /path/to/build-tools/36.0.0/aapt2
```

`compileNativeAttendance` mengompilasi Java Android terpisah; D8 menghasilkan `greatday8/native-attendance.mpe` dalam resource bundle. `extendWith` menggabungkannya ke DEX aplikasi. Tes native memakai Robolectric Android 16 / API 36; tidak mengakses ponsel atau akun nyata. Verifikasi APK opsional menghasilkan APK **unsigned** di `patches/build/native-target-check/`, tanpa memasang atau mengirim apa pun.

Validasi lokal tahap ini: 78 tes Node, 46 pemeriksaan aturan JVM, 17 tes komponen Robolectric API 36, tiga skenario browser native, regresi browser lama termasuk 16 pilihan fitur/dua tema/dua layout, enam fingerprint APK, serta penerapan patch ke APK acuan dan build MPP lulus. Verifikasi artefak mengonfirmasi 26 definisi class native masing-masing muncul satu kali di APK hasil, komponen privat, `stopWithTask=false`, service tipe lokasi, izin alarm tanpa batas API 33, dan guard pengiriman offline.

Android Lint lulus dengan 0 error dan 7 peringatan mengenai versi dependensi/katalog dan teks Indonesia yang belum memakai resource lokalisasi. Identitas akun yang belum selesai dimuat pada startup tidak dianggap logout; akun baru yang sudah dikenali atau logout setelah akun dikenali merekonsiliasi konfigurasi native. Hook GreatDay nyata kelak tetap memerlukan verifikasi akun native sebelum menyimpan.

## Batas bukti dan pengujian perangkat

Alarm native tidak bergantung pada proses/WebView tetap hidup. Dua percobaan Poco X7 Android 16 / HyperOS 3.0 pada 8 November 2026 sudah berhasil: setelah swipe/proses mati dengan layar mati, dan setelah restart/unlock tanpa membuka GreatDay. Hasil hanya dummy, antrean lama tetap 8, dan jadwal dikembalikan nonaktif pada 07:00/19:00 Senin–Jumat. Lihat laporan perangkat. Doze mendalam, semalaman, dan ketepatan semua jadwal belum dibuktikan. Autostart dan No restrictions membantu konfigurasi, bukan jaminan.

Uji secara terpisah: aplikasi terbuka, Home, layar mati tanpa charger, swipe Recent Apps, penghentian proses biasa, reboot dan unlock, Doze mendalam, izin ditolak/dicabut, GPS mati, dan pembukaan aplikasi bertepatan alarm. Gunakan satu slot masuk/pulang yang belum dicoba pada tanggal WITA itu. Periksa waktu alarm, waktu service, hasil dummy, notifikasi, dan tidak adanya tambahan catatan GreatDay.

**Force stop** berbeda dari swipe: Android membatalkan pending intent dan membatasi aktivasi ulang sampai interaksi pengguna. Buka GreatDay lagi untuk rekonsiliasi alarm. Tidak ada mekanisme melewati Force stop.

Jangan mengganti build uji dengan build yang membuka sinkronisasi sebelum meninjau antrean GreatDay lama. Tahap native ini tidak menghapus antrean enam catatan pengujian trial.5 atau mengirimkannya.
