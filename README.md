# Facebook Marketplace AI

Scrape Facebook Marketplace listings dan cari pakai AI search — stealth browser, auto city detection, full-stack monorepo.

---

## Features

- **Stealth Scraper** — Playwright + anti-detection fingerprint, auto city dari cookies Facebook, penanganan otomatis akun terblokir dan popup notifikasi
- **AI Search & Analisis** — Pencarian cerdas dengan NLP pipeline (normalisasi, FTS, fuzzy matching, sinonim, deteksi harga). Menggunakan model Gemini 1.5 Flash untuk analisis spesifikasi produk (RAM, Storage, kelengkapan, minus, dan garansi)
- **Ekspor Laporan PDF Profesional** — Ekspor hasil analisis pasar berformat monokrom minimalis profesional, bebas defect pemotongan halaman (page-break), serta dilengkapi tautan teks aktif dan kode QR
- **Desain Dashboard Modern** — Tata letak responsif dengan panel bento grid, visualisasi statistik, serta slider filter aktif mendatar (horizontal) yang rapi
- **Full-stack Monorepo** — Node.js/Express backend + React frontend + Python scraper
- **Zero hardcode** — Parsing via pattern matching, bukan kata-kata bahasa spesifik
- **Parallel scraping** — 3 tab paralel untuk detail halaman (seller, kondisi, deskripsi)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, TypeScript, TailwindCSS v4 |
| Backend | Node.js, Express, TypeScript, Prisma |
| Database | PostgreSQL |
| Scraper | Python, Playwright, playwright-stealth, browserforge |

---

## Prerequisites

Pastikan sudah terinstall:

- Node.js v18+
- Python 3.10+
- PostgreSQL 14+ (Jika belum terinstall di Windows, Anda bisa menggunakan perintah `winget install PostgreSQL.PostgreSQL.16 --silent --override "--mode unattended --superpassword <password> --serverport 5432"` di terminal Administrator).

---

## Setup & Installation

### 1. Clone repo

```bash
git clone https://github.com/haikal-266/marketplace-ai.git
cd marketplace-ai
```

### 2. Install Node.js dependencies & Playwright Browser

```bash
# Install node packages
npm install

# Install Chromium browser untuk backend (untuk alur interaktif login Facebook)
npx playwright install chromium
```

### 3. Setup Backend

```bash
# Copy file environment
cp backend/.env.example backend/.env
```

Edit `backend/.env` dan isi nilainya:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/marketplace_ai"
PORT=3001
NODE_ENV=development

# Generate key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
COOKIE_ENCRYPTION_KEY="isi_dengan_32_karakter_random"

# Catatan PYTHON_PATH:
# - Windows: "./scraper/venv/Scripts/python.exe"
# - Linux/Mac: "./scraper/venv/bin/python"
PYTHON_PATH="./scraper/venv/Scripts/python.exe"

SCRAPER_SCRIPT_PATH="./scraper/scraper.py"
FRONTEND_URL="http://localhost:5173"

# Gemini API Key untuk analisis laporan oleh AI
GEMINI_API_KEY="isi_dengan_api_key_gemini_kamu"
```

### 4. Setup Database

```bash
# Jalankan migration (Masukkan nama migrasi seperti 'sync' jika diminta)
npm run db:migrate

# Isi data awal kamus istilah & sinonim
npm run db:seed
```

### 5. Setup Python Scraper

```bash
cd scraper

# Buat virtual environment
python -m venv venv
# Aktifkan virtual environment
# - Windows (PowerShell): venv\Scripts\activate
# - Linux/Mac: source venv/bin/activate

# Install python dependencies
venv\Scripts\pip install -r requirements.txt

# Install Playwright browser khusus python scraper
venv\Scripts\playwright install chromium

cd ..
```

---

## Setup Cookies Facebook

Scraper butuh cookies Facebook yang valid untuk bisa akses Marketplace.

### Cara 1: EditThisCookie (Direkomendasikan)

1. Install ekstensi [EditThisCookie](https://chromewebstore.google.com/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg) di Chrome
2. Login ke Facebook
3. Buka `facebook.com/marketplace`
4. Klik ikon ekstensi → **Export** (format JSON)
5. Simpan file sebagai `cookies.json` di folder `scraper/`

### Cara 2: Chrome DevTools Manual

1. Login Facebook → tekan `F12` → tab **Application** → **Cookies** → `facebook.com`
2. Buka dan buat file `scraper/cookies.json`:

```json
[
  {"name": "c_user", "value": "USER_ID_KAMU", "domain": ".facebook.com"},
  {"name": "xs",     "value": "TOKEN_XS",     "domain": ".facebook.com"},
  {"name": "datr",   "value": "DATR_VALUE",   "domain": ".facebook.com"},
  {"name": "fr",     "value": "FR_VALUE",      "domain": ".facebook.com"},
  {"name": "sb",     "value": "SB_VALUE",      "domain": ".facebook.com"}
]
```

> **Jangan commit cookies.json ke GitHub!** File ini sudah otomatis diabaikan di `.gitignore`.

---

## Menjalankan Aplikasi

### Development (semua sekaligus)

```bash
npm run dev
```

Ini akan menjalankan backend (port `3001`) and frontend (port `5173`) secara bersamaan.

### Atau jalankan terpisah

```bash
# Hanya backend
npm run dev:backend

# Hanya frontend
npm run dev:frontend
```

Buka browser di **http://localhost:5173**

---

## Menjalankan Scraper Langsung (CLI)

```bash
cd scraper
source venv/bin/activate

# Cari "laptop", auto-detect kota dari cookies, ambil 20 listing
python scraper.py "" "laptop" 20 --headless

# Cari "iphone" dengan kota spesifik + output JSON
python scraper.py "104092119625829" "iphone" 15 --headless --details --api

# Pakai cookies akun lain
python scraper.py "" "motor" 30 --headless --api --cookies=akun2.json
```

### Argumen CLI

```
python scraper.py <city> <query> <count> [flags]
```

| Argumen | Default | Keterangan |
|---------|---------|------------|
| `city` | `""` (auto) | City ID atau kosong untuk auto-detect dari cookies |
| `query` | `""` | Kata kunci pencarian |
| `count` | `50` | Jumlah maksimal listing yang diambil |

### Flags

| Flag | Keterangan |
|------|------------|
| `--headless` | Browser jalan di background (tidak tampil) |
| `--details` | Ambil detail halaman: seller, kondisi, deskripsi |
| `--api` | Output pure JSON (bisa di-pipe ke `jq`) |
| `--cookies=PATH` | Gunakan file cookies custom |

---

## Struktur Project

```
marketplace-ai/
├── backend/                # Node.js + Express API
│   ├── prisma/             # Schema & migrations database
│   ├── src/
│   │   ├── modules/        # Auth, search, scraper, listing
│   │   ├── pipeline/       # AI search pipeline (NLP stages)
│   │   └── utils/
│   └── .env.example
├── frontend/               # React + Vite UI
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
├── scraper/                # Python Playwright scraper
│   ├── scraper.py
│   ├── config.py
│   ├── models.py
│   └── requirements.txt
└── package.json            # Root monorepo
```

---

## Scripts Tersedia

| Command | Keterangan |
|---------|------------|
| `npm run dev` | Jalankan backend + frontend bersamaan |
| `npm run dev:backend` | Hanya backend |
| `npm run dev:frontend` | Hanya frontend |
| `npm run build` | Build production |
| `npm run db:migrate` | Jalankan database migration |
| `npm run db:seed` | Isi data awal |
| `npm run db:studio` | Buka Prisma Studio (GUI database) |

---

## Troubleshooting

**playwright install gagal**
```bash
# Install system dependencies dulu (Linux)
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1
playwright install chromium
```

**Database connection error**
- Pastikan PostgreSQL sudah jalan: `sudo service postgresql start`
- Cek `DATABASE_URL` di `backend/.env` sudah benar

**Scraper tidak bisa login / listing kosong**
- Cookies kamu mungkin expired — export ulang cookies dari browser
- Coba tanpa `--headless` dulu untuk lihat apa yang terjadi di browser
- Periksa apakah akun Facebook Anda terhalang oleh pop-up perihal update "Akun Meta". Jika ya, login manual di browser biasa dan selesaikan instruksi pop-up tersebut agar hilang selamanya.

---

## Disclaimer

Project ini untuk keperluan edukasi dan riset pribadi. Penggunaan scraper harus mematuhi Facebook Terms of Service. Jangan gunakan untuk spam atau tujuan komersial tanpa izin.
