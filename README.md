# 🐝 BeeCOMP Service v3.0 — Antri Servis Online

Web app antrian servis berbasis **Google Apps Script + Google Sheets**, bisa dibuka langsung dari URL Web App **atau** dari **GitHub Pages**.

```
beecomp-service/
├── apps-script/        ← salin ke editor Apps Script (Code.gs, Index, CSS, JS, appsscript.json)
├── docs/               ← situs GitHub Pages (index.html, config.js, assets/)
├── src/                ← SUMBER tampilan (body.html, style.css, app.js) — edit di sini
└── build.mjs           ← `node build.mjs` → menghasilkan apps-script/*.html & docs/
```

> Ubah tampilan? Edit file di `src/`, lalu jalankan `node build.mjs`. Kedua versi (Apps Script & GitHub) langsung ikut berubah.

---

## 1. Perbarui Apps Script (URL lama tetap sama)

1. Buka Google Sheets Anda → **Extensions → Apps Script**.
2. Ganti isi file berikut dengan file dari folder `apps-script/`:
   `Code.gs`, `Index.html`, `CSS.html`, `JS.html`.
   (Opsional: **Project Settings → Show "appsscript.json"**, lalu ganti isinya juga.)
3. Simpan, pilih fungsi **`setupSpreadsheet`** di dropdown → **Run**.
   Fungsi ini aman dijalankan berulang: hanya menambah sheet/kolom/kunci yang belum ada
   (sheet `Konsultasi`, `Anggota`, kolom `Kode Akses`, dan kunci Pengaturan baru),
   serta memberi **kode akses** untuk antrian lama.
4. Ganti password di sheet **Admin**, lalu jalankan **`amankanPasswordAdmin`**
   (atau menu **🐝 BeeCOMP → Amankan password admin**) agar password tersimpan sebagai hash.
5. **Deploy → Manage deployments → ✏️ Edit** deployment yang ada →
   **Version: New version** → **Deploy**.
   ⚠️ Jangan pilih "New deployment", karena URL akan berubah.
   Pastikan: *Execute as: Me* dan *Who has access: Anyone*.

## 2. Publikasikan ke GitHub Pages

1. Buat repository baru di GitHub (mis. `beecomp-service`), unggah seluruh isi folder ini.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   Branch: `main`, Folder: **`/docs`** → Save.
3. Situs aktif di `https://<username>.github.io/beecomp-service/` dalam 1–2 menit.
4. Isi URL tersebut ke sheet **Pengaturan → `UrlWebPublik`**, agar tombol di email
   ("Cek Progres", "Buka Percakapan") mengarah ke situs GitHub.

`docs/config.js` sudah berisi URL Web App Anda:

```js
window.BEECOMP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwC5D7m.../exec'
};
```

Frontend GitHub memanggil Apps Script lewat `doPost` (JSON, `Content-Type: text/plain`
sehingga tidak memicu preflight CORS). Kosongkan `GAS_URL` untuk **Mode Demo**
(data contoh, login admin demo: `admin` / `admin123`).

---

## 3. Fitur & cara pakai

| Fitur | Keterangan |
|---|---|
| **Ambil antrian** | Nomor antrian + **kode akses rahasia** (10 karakter, mis. `AB2CD-3EF4G`) dikirim via email. |
| **Cek progres** | Hanya dengan kode akses. Tampil progress bar, rincian biaya/voucher, riwayat, tombol kuitansi. Tautan email `?kode=...` langsung membuka hasilnya. |
| **Konsultasi** | Chat per antrian. Hanya pemegang kode akses (dan admin) yang bisa membaca. Admin dapat notifikasi badge; pelanggan dapat email saat dibalas. |
| **Daftar anggota** | Info deskripsi/manfaat/ketentuan diambil dari sheet Pengaturan. Pendaftar masuk sheet `Anggota` dengan status *Menunggu Verifikasi*; admin mengaktifkan di tab **Anggota**. Antrian dari anggota aktif diberi lencana 👑. |
| **Panel admin tersembunyi** | Tombol Admin dihapus. **Ketuk logo kiri atas 5× cepat** untuk membuka. |
| **Mode gelap** | Ikuti pilihan pengguna / pengaturan sistem. |

### Kunci baru di sheet *Pengaturan*

| Key | Fungsi |
|---|---|
| `EmailAdmin` | Email penerima notifikasi antrian / konsultasi / anggota baru (opsional). |
| `UrlWebPublik` | URL GitHub Pages untuk tautan di email. Kosong = pakai URL Web App. |
| `KirimEmailBalasanKonsultasi` | `TRUE`/`FALSE`. |
| `AnggotaDeskripsi` | Paragraf deskripsi program anggota. |
| `AnggotaManfaat` | Daftar manfaat, **1 baris = 1 poin** (Alt+Enter di sel, atau pisahkan dengan `\|`). |
| `AnggotaKetentuan` | Daftar syarat & ketentuan, format sama. |

Perubahan di sheet Pengaturan langsung berlaku (cache dibersihkan otomatis saat sel diedit).

---

## 4. Perbaikan keamanan & bug (dibanding v2.3)

**Kritis**
- **Fungsi admin bisa dipanggil siapa saja** — sebelumnya `getAllAntrianServis`, `selesaikanAntrianServis`, dll. tidak memeriksa login, sehingga siapa pun bisa membaca seluruh data pelanggan / mengubah status dari console browser. Kini semua wajib **token sesi** (6 jam, disimpan di CacheService).
- **Kebocoran data di Cek Status** — pencarian *substring* pada ID/No/email/WA: mengetik `a` atau `@` menampilkan data banyak pelanggan. Kini **hanya kode akses persis**.
- **Kuitansi bisa ditebak** — `?action=kuitansi&id=SRV-123456` (6 digit) membuka nama, email, WA. Kini memakai kode akses.
- **XSS** — nama/keluhan pelanggan dimasukkan mentah ke email & kuitansi (yang ditampilkan di panel admin). Kini semua di-escape; tombol aksi admin memakai `data-*` (bukan `onclick` berisi input pengguna).
- **Formula injection** — input diawali `=`, `+`, `-`, `@` kini disimpan sebagai teks.

**Bug**
- Nomor antrian bisa **dobel** saat dua orang daftar bersamaan → kini memakai `LockService`.
- **Angka 0 di No. WA hilang** (tersimpan sebagai angka) → kini dinormalisasi ke `62…` dan disimpan sebagai teks.
- **Voucher stok 1**: setelah divalidasi stok jadi 0, lalu saat "Selesaikan" voucher dianggap habis sehingga **potongan tidak diterapkan** → diperbaiki.
- Voucher bisa divalidasi 2× (stok berkurang 2×) → dicegah.
- Alur status tidak divalidasi server (mis. verifikasi bayar 2×, tandai diambil sebelum lunas) → dicegah.
- Klik peta memicu layar "Konten disembunyikan" (event `blur`) → kini penyamaran hanya aktif saat panel admin terbuka, dan mengabaikan fokus ke iframe peta.
- Ikon `fa-triangle-exclamation` tidak muncul (nama ikon FA6 di FA5) → kini memakai Font Awesome 6.
- Login: kunci 15 menit setelah 5× gagal; password bisa disimpan sebagai hash SHA-256 + salt.
- `setupSpreadsheet` / `amankanPasswordAdmin` hanya bisa dijalankan pemilik dari editor.

**Kecepatan**
- Tanpa jQuery & Bootstrap (±300 KB lebih ringan), info usaha di-cache di browser (tampil instan).
- Pengaturan di-cache 2 menit, papan antrian 20 detik di server; polling berhenti saat tab tidak terlihat.
- Penulisan sheet digabung (lebih sedikit panggilan API).

---

## 5. Catatan

- **Proteksi screenshot** tetap bersifat *penangkal* (klik-kanan diblok, watermark nama admin, layar disamarkan saat jendela tidak aktif). Browser tidak menyediakan cara untuk benar-benar memblokir screenshot.
- Kuota email Gmail biasa ±100/hari. Bila email gagal (kuota habis), pelanggan diarahkan ke Helpdesk; admin bisa melihat & menyalin kode akses di panel, atau menekan **Kirim Kode** keesokan harinya.
- Pelanggan lama (sebelum v3) belum menerima kode akses: tekan **Kirim Kode** di kartu antrian mereka.
