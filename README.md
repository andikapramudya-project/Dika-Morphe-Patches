# Dika-Morphe-Patches

Kode patch GreatDay berbasis Morphe, versi sumber 0.9.0-trial.1. Versi Hermes terdahulu direkonsiliasi ke satu basis sumber.

## Build

JDK 21, Android SDK Platform 36/Build Tools 36.0.0, dan akses dependency Morphe diperlukan.

```powershell
.\gradlew.bat buildAndroid --console=plain
```

Wrapper Gradle dari template Morphe yang tersedia lokal telah disertakan. Bila registry GitHub Packages meminta autentikasi, gunakan `gpr.user`/`gpr.key` pada konfigurasi Gradle pribadi di luar repositori, atau environment yang didukung settings Gradle. Jangan commit token.

Pengujian JavaScript:

```sh
node tests/scheduler.test.cjs
node tests/background.test.cjs
node tests/native.test.cjs
```

Rilis terbaru yang tersedia masih **trial**. Kode native memiliki keterbatasan integrasi yang dicatat dalam `docs/NATIVE-TRIAL.md`; paket ini tidak menjadikannya rilis stabil. Gerbang pengiriman dan konfirmasi pengguna dipertahankan. Tidak ada APK GreatDay, kredensial perusahaan, data lokasi pengguna, atau APK uji yang dimasukkan.

Sesuaikan metadata sumber dan `patches-bundle.json` ke repositori baru sebelum menjadikannya sumber Morphe. Lisensi dan NOTICE template dipertahankan.

## Rilis dan repositori

Rilis lokal yang tersedia berada dalam `releases/`; cocokkan SHA-256 pada `releases/SHA256SUMS.txt`. Rilis diabaikan oleh Git agar diunggah terpisah melalui GitHub Releases.

Gunakan folder ini sebagai root repositori baru. Kredensial, riwayat Git lama, data pribadi, cache, rancangan agent, dan draft tidak disertakan. Metadata yang masih bertanda `REPLACE_WITH_...` perlu diisi sesuai hosting tujuan.

## Pemeriksaan paket sumber — 22 November 2026

78 tes JavaScript dan Gradle buildAndroid offline lulus. Versi sumber dan rilis tetap trial; tidak diuji ke server atau perangkat.
