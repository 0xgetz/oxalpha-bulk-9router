<div align="center">

<img src="../brand/logo.svg" alt="Ox Alpha bulk — 9Router" width="420">

### Buat massal sesi Ox Alpha · jadikan pool · sajikan OpenAI-compatible · sambungkan ke 9Router

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blueviolet)](../package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](../LICENSE)
[![9Router](https://img.shields.io/badge/9router-compatible-6e56cf)](https://9router.com)
[![Model](https://img.shields.io/badge/model-z--ai%2Fglm--5.3--flash-8b74e8)](https://oxalpha.com/chat)
[![Status](https://img.shields.io/badge/E2E-terverifikasi-36c98f)](#verifikasi)

[English](../README.md) ·
[Indonesia](README.id.md) ·
[中文](README.zh.md) ·
[日本語](README.ja.md) ·
[Español](README.es.md)

</div>

---

## Apa ini

**Ox Alpha** adalah chat gratis "stealth reasoning" di
[oxalpha.com/chat](https://oxalpha.com/chat) — tanpa daftar, tanpa API key. Hanya
satu model:

| ID upstream | Nama tampilan | Konteks | Catatan |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` | **Ox Alpha** (slug `ox-alpha`) | 1M token | SSE, reasoning aktif. Dirutekan via Parasail / CoreWeave / DigitalOcean. |

ID model lain akan ditolak `422 Invalid model`.

Toolkit ini:

1. **Membuat massal** sesi anonim Ox Alpha — satu konteks browser terisolasi per
   akun, cookie tidak pernah bertabrakan.
2. **Menggabungkan** ke pool (round-robin + failover otomatis) sehingga kuota
   gratis bertambah seiring jumlah sesi.
3. **Menyajikan** API OpenAI-compatible (`/v1/chat/completions`, `/v1/models`).
4. **Mendaftarkan** diri ke [9Router](https://9router.com) sebagai provider
   `openai-compatible`.

Tanpa dependensi npm. Node ≥ 18 murni. Satu Chromium.

## Kenapa butuh browser

Ox Alpha mengikat sesi anonim **dan** checkpoint Cloudflare Turnstile ke IP
klien. Cookie yang sama yang berhasil di browser mengembalikan
`HTTP 428 {"code":"turnstile_required"}` dari IP server. Jadi setiap request
di-relay dari **dalam halaman `oxalpha.com` yang hidup**, memakai IP keluar,
cookie jar, dan ﬁngerprint TLS browser.

- **Chromium lokal** (default): `CHROME_PATH=/usr/bin/chromium`.
- **Chromium remote / cloud**: `CDP_URL=wss://…/devtools/browser/<id>`.

## Mulai cepat

```bash
# 0. siapkan browser
export CHROME_PATH=/usr/bin/chromium        # atau: export CDP_URL=wss://…

# 1. (opsional) salin template konfigurasi
cp config.example.json config.json

# 2. buat 5 sesi -> accounts.json
./run.sh create --count 5 --concurrency 2

# 3. lihat pool
./run.sh list

# 4. jalankan adapter pool OpenAI-compatible (default :8790)
./run.sh adapter

# 5. daftarkan ke 9Router (lokal :20128 atau https://9router.com)
ROUTER_URL=http://127.0.0.1:20128 ROUTER_PASSWORD=123456 ./run.sh connect
```

Lalu pakai seperti provider OpenAI biasa:

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"oxalpha/z-ai/glm-5.3-flash",
       "messages":[{"role":"user","content":"halo"}]}'
```

## CLI

| Perintah | Deskripsi |
| --- | --- |
| `node src/cli.js create --count N [--concurrency K]` | Buat N sesi ke `accounts.json` |
| `node src/cli.js list` | Tampilkan pool, pemakaian/sisa per sesi |
| `node src/cli.js adapter` | Jalankan adapter pool OpenAI-compatible |
| `node src/cli.js connect` | Daftarkan adapter ke 9Router |
| `node src/cli.js test "halo"` | Chat sekali lewat sesi baru |

## Endpoint adapter

| Method | Path | Deskripsi |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | Chat (stream + non-stream) |
| `GET` | `/v1/models` | `oxalpha/z-ai/glm-5.3-flash` |
| `GET` | `/health` | Status + statistik pool |
| `GET` | `/pool` | Pemakaian / sisa / kesehatan tiap sesi |
| `POST` | `/pool/reload` | Muat ulang dari `accounts.json` |

## Verifikasi

Diuji end-to-end terhadap 9Router yang berjalan (v0.5.99):

```
pool ready: 3/3 healthy, 3 live
router models: ["oxalpha/z-ai/glm-5.3-flash"]
router non-stream: 200
router SSE: 200  "X Y Z"  → data: [DONE]
```

`accounts.json` berisi cookie sesi hidup — **di-ignore git**.

## Lisensi

MIT — lihat [LICENSE](../LICENSE).
