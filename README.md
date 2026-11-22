<h1 align="center">Dika Morphe Patches</h1>

<p align="center">Kumpulan patch berbasis Morphe untuk GreatDay 8.</p>

<p align="center">
  <img alt="Versi" src="https://img.shields.io/badge/versi-0.9.0--trial.1-d97706?style=flat-square" />
  <img alt="Status" src="https://img.shields.io/badge/status-trial-d97706?style=flat-square" />
  <img alt="Target" src="https://img.shields.io/badge/target-GreatDay%201.79.1-555?style=flat-square" />
  <img alt="Lisensi" src="https://img.shields.io/badge/lisensi-GPL--3.0-2563eb?style=flat-square" />
</p>

<p align="center">
  <a href="#status">Status</a> ·
  <a href="#struktur">Struktur</a> ·
  <a href="#build">Build</a> ·
  <a href="#dokumentasi">Dokumentasi</a> ·
  <a href="#penafian">Penafian</a>
</p>

---

## Ringkasan

Repositori ini memuat kode patch [Morphe](https://github.com/MorpheApp/morphe-patches-template) untuk aplikasi GreatDay 8 (`com.greatday.app`). Versi sumber saat ini adalah **0.9.0-trial.1**. Basis kode patch versi Hermes terdahulu telah digabung ke satu sumber.

Tahap trial ini menguji jadwal native dengan alarm exact (bawaan 07:00 dan 19:00 WITA, Senin–Jumat), notifikasi, dan penyimpanan lokasi sementara di penyimpanan privat patch. Hook ke GreatDay mengembalikan `NOT_IMPLEMENTED`, sehingga patch **belum mencatat apa pun ke antrean GreatDay**.

## Status

| Aspek | Keterangan |
| --- | --- |
| Rilis | Trial; bukan rilis stabil |
| Target | APK GreatDay 8 versi 1.79.1 (22725), dicocokkan lewat enam fingerprint |
| Hook GreatDay | `NOT_IMPLEMENTED` |
| Pengiriman offline | Gerbang pengiriman dan konfirmasi pengguna dipertahankan |
| Pengujian perangkat | Poco X7; Doze mendalam/semalaman belum diuji |

Batasan integrasi native dicatat pada [docs/NATIVE-TRIAL.md](docs/NATIVE-TRIAL.md). Repositori tidak memuat APK GreatDay, kredensial perusahaan, data lokasi pengguna, maupun APK uji.

## Struktur

```text
patches/          Patch Morphe (Kotlin) dan resource JavaScript
native-runtime/   Extension native Android (alarm, service, penyimpanan)
tests/            Pengujian JavaScript dan browser
scripts/          Pemeriksaan target dan artefak
docs/             Kompatibilitas, pengembangan, uji perangkat, uji native
patches-bundle.json   Metadata bundle untuk Morphe
```

## Build

**Prasyarat:** JDK 21, Android SDK Platform 36 dengan Build Tools 36.0.0, dan akses ke dependensi Morphe.

```powershell
.\gradlew.bat buildAndroid --console=plain
```

Bila registry GitHub Packages meminta autentikasi, simpan `gpr.user` dan `gpr.key` pada konfigurasi Gradle pribadi di luar repositori, atau lewat environment yang didukung `settings.gradle.kts`. **Jangan men-commit token.**

<details>
<summary>Pengujian</summary>

```sh
node tests/scheduler.test.cjs
node tests/background.test.cjs
node tests/native.test.cjs
```

Daftar lengkap pemeriksaan (browser smoke, Robolectric, verifikasi APK target, dan artefak) ada di [docs/NATIVE-TRIAL.md](docs/NATIVE-TRIAL.md).

Validasi lokal terakhir (22 November 2026): 78 pengujian JavaScript dan `buildAndroid` offline lulus. Belum diuji terhadap server atau akun nyata.
</details>

## Rilis

Rilis lokal berada di `releases/`; cocokkan SHA-256 pada `releases/SHA256SUMS.txt`. Folder ini diabaikan Git dan diunggah terpisah melalui GitHub Releases. Sesuaikan metadata sumber dan `patches-bundle.json` bila repositori dipindahkan atau dijadikan sumber Morphe baru.

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | Riwayat perubahan |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Audit kompatibilitas dan fingerprint target |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Panduan pengembangan |
| [docs/DEVICE_TESTS.md](docs/DEVICE_TESTS.md) | Checklist uji perangkat |
| [docs/NATIVE-TRIAL.md](docs/NATIVE-TRIAL.md) | Panduan dan batasan uji native |

## Penafian

Proyek ini tidak berafiliasi dengan pengembang GreatDay maupun proyek Morphe. Gunakan hanya pada aplikasi yang Anda miliki secara sah dan sesuai kebijakan serta ketentuan penggunaan yang berlaku, termasuk ketentuan perusahaan Anda.

## Lisensi

[GNU GPL v3](LICENSE). Pemberitahuan dari template Morphe dipertahankan pada [NOTICE](NOTICE), termasuk pembatasan penggunaan nama Morphe pada versi turunan.
