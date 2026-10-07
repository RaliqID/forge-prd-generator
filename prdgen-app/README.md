# FORGE

FORGE — AI PRD Generator: ubah ide produk jadi PRD lengkap, streaming, multi-provider AI, share link, export PDF.

## Features

- **Generate PRD streaming** — ide produk diubah jadi Product Requirements Document lengkap, output muncul real-time per bagian
- **Katalog model multi-provider** — 9Router (default, lokal), AgentRouter, OpenRouter; fallback otomatis antar provider
- **Custom engines (BYOK)** — tambah engine sendiri dengan API key sendiri, diuji langsung via `/api/engines/test`
- **Chat refine** — perbaiki/perluas PRD lewat percakapan kontekstual
- **Mindmap & task board** — struktur rencana divisualisasikan jadi mindmap (Mermaid) dan task list
- **Share links** — PRD bisa dibagikan via token publik tanpa login
- **Export PDF** — PRD di-export jadi PDF rapi (header, footer, page-break aware)
- **Dark/light theme** — theme switcher tanpa flash, tersimpan per-browser
- **Dokumen input multi-format** — paste teks / upload file, di-extract jadi konteks PRD

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Framework | Next.js 16 (App Router, `--webpack`) |
| UI | React 19, Tailwind CSS 4, shadcn/base-ui, lucide-react |
| Bahasa | TypeScript 5 |
| ORM/DB | Prisma 6, PostgreSQL 17 (Supabase-compatible) |
| Auth | Supabase (optional; dev-mode tanpa Supabase) |
| State/Data | Zustand 5, TanStack Query 5 |
| Markdown/PDF | react-markdown + remark-gfm, rehype-highlight, html2pdf.js |
| Diagram | Mermaid 11 |

## Quick Start

```bash
npm install
cp .env.example .env.local
# isi DATABASE_URL, ENGINE_ENC_SECRET, dan minimal 1 AI provider key
npm run db:push
npm run dev          # http://localhost:5555
```

Detail lengkap (Supabase, dev-mode auth, deployment): lihat [SETUP.md](./SETUP.md).

### One-click launcher (Windows)

`start.bat` menyalakan semuanya — Postgres portable lalu dev server — **tanpa
jendela console** (tidak ada tab `next-server`/`FORGE postgres` muncul di
taskbar), lalu membuka browser:

```bat
start.bat      :: jalankan Postgres + dev server (hidden), buka browser
stop.bat       :: hentikan keduanya (data tetap aman)
```

- App berjalan di **port 5555**, bukan 3000 — port 3000 dipakai project lain
  (Striv) di mesin yang sama. Ubah lewat `set FORGE_PORT=...` sebelum menjalankan.
- `stop.bat` hanya mematikan proses milik FORGE (lewat PID yang dicatat
  `start.bat`), jadi project lain di port berdekatan tidak ikut mati.
- Log ada di `logs/` (`dev.log`, `postgres.log`).

### Scripts

| Script | Fungsi |
|--------|--------|
| `npm run dev` | Dev server di port 5555 |
| `npm run build` / `npm start` | Build + jalankan produksi |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Unit test (Vitest) |
| `npm run test:coverage` | Unit test + laporan coverage |
| `npm run verify` | typecheck + lint + test sekaligus |
| `npm run db:push` / `db:migrate` / `db:studio` | Prisma |

## Kesehatan Aplikasi

```bash
curl http://localhost:5555/api/health
```

```jsonc
{
  "status": "healthy",
  "checks": {
    "database":        { "status": "ok", "detail": "106ms" },
    "aiProviders":     { "status": "ok", "detail": "9router" },
    "auth":            { "status": "missing", "detail": "dev mode (no Supabase configured)" },
    "structuredModel": { "status": "ok", "detail": "deepseek-v4.1-flash" }
  }
}
```

`503` hanya ketika dependency keras (database) mati. Endpoint ini publik — tidak
perlu sesi, supaya load balancer/orchestrator bisa memakainya.

## AI Providers

| Provider | Env | Model | Keterangan |
|----------|-----|-------|------------|
| **9Router** (default) | `NINE_ROUTER_API_KEY`, `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_MODEL` | `Dev-Stack` | Proxy lokal `http://localhost:20128/v1` (recommended); hosted `https://api.9router.com/v1` optional. Model ID free-form. |
| AgentRouter | `AGENTROUTER_API_KEY` | `claude-opus-4-8` (fixed) | https://agentrouter.org |
| OpenRouter | `OPENROUTER_API_KEY` | banyak (GPT, Claude, Gemini, Kimi, DeepSeek, Qwen) | https://openrouter.ai — internal ID di-map ke slug |

Fallback otomatis: 9Router → AgentRouter → OpenRouter.

### Dua model, dua peran

Ada dua phase dengan kebutuhan berbeda, dan memakai satu model untuk keduanya
menyebabkan kegagalan nyata:

| Phase | Env | Kebutuhan | Kenapa |
|-------|-----|-----------|--------|
| Prose PRD (17 section) | `NINE_ROUTER_MODEL` | Model menulis panjang | Combo alias (`Dev-Stack`) boleh dipakai. |
| Struktur & Task (JSON) | `NINE_ROUTER_STRUCTURED_MODEL` | **Model instruct eksplisit** | Alias combo me-rotasi upstream; upstream bertipe coding-agent menjawab prompt "hasil JSON" dengan mencoba **menjalankan shell command** (markup tool-call) atau menulis prosa — bukan JSON. Akibatnya feature map kosong dan client retry berkali-kali (±170s terbuang). |

Set `NINE_ROUTER_STRUCTURED_MODEL` ke model instruct eksplisit (contoh
`deepseek-v4.1-flash`); thinking dimatikan otomatis di phase ini supaya cepat.

## Environment Variables

<details>
<summary>Ringkasan (klik untuk buka)</summary>

| Variabel | Fungsi |
|----------|--------|
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` | Base URL untuk SEO, robots, sitemap, header OpenRouter |
| `DATABASE_URL` / `DIRECT_URL` | Postgres — pooled + direct connection (Supabase atau lokal) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth asli; kosong = dev-mode |
| `NINE_ROUTER_API_KEY`, `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_MODEL` | Provider AI utama (prose) |
| `NINE_ROUTER_STRUCTURED_MODEL` | Model untuk phase JSON (Struktur/Task) — harus instruct eksplisit |
| `AGENTROUTER_API_KEY`, `OPENROUTER_API_KEY` | Provider AI alternatif |
| `ENGINE_ENC_SECRET` | AES-256-GCM untuk enkripsi API key engine tersimpan (wajib) |
| `ALLOW_LOCAL_AI_ENDPOINTS` | `true` = izinkan base URL localhost untuk custom engine (self-hosted single-user saja) |
| `AI_STREAM_DEADLINE_MS` / `AI_STREAM_INACTIVITY_MS` | Timeout keseluruhan / tanpa-aktivitas (default 280s / 200s) |
| `LOG_LEVEL` | `debug`\|`info`\|`warn`\|`error` (default `info`) |

</details>

## Batas Input

Semua batas panjang & jumlah ada di satu file: **`src/lib/validation/limits.ts`**,
masing-masing dengan alasan ukurannya. Ringkasan budget yang penting:

| Input | Batas | Kira-kira |
|-------|-------|-----------|
| **Ide** (textarea halaman baru) | `IDEA_MAX_CHARS` = 300.000 karakter | **~50.000 kata** |
| Field naratif form (deskripsi, target users, problem, catatan) | `FIELD_MAX_CHARS` = 20.000 karakter | ~3.300 kata |
| Label pendek (nama produk, timeline, nama fitur) | `LABEL_MAX_CHARS` = 600 karakter | ~100 kata |
| Satu section PRD (sebagai konteks) | `SECTION_CONTENT_MAX_CHARS` = 200.000 karakter | ~33.000 kata |
| Jumlah fitur / tech stack / platform | 200 / 100 / 40 item | — |

Context window provider yang dipakai ±1M token dengan budget output 384K token,
jadi brief panjang bukan hambatan teknis — batas ini ada untuk membatasi memori
dan menolak payload yang tidak wajar, dan dipasang jauh di atas pemakaian nyata.

**Perilaku saat melebihi batas**

- UI: counter di bawah textarea menampilkan `terpakai / 300.000` dan berubah
  warna mulai 90% pemakaian; tombol submit dinonaktifkan saat sudah lewat batas.
- API: `422` dengan pesan yang menyebut batasnya dalam karakter **dan** kata,
  contoh: `Ide terlalu panjang: maksimal 300.000 karakter (~50.000 kata).`
  (bukan lagi `Too big: expected string to have <=20000 characters`).

Untuk mengubah batas, cukup edit `limits.ts` — schema validasi, pesan error, dan
counter UI semuanya membaca dari sana.

## Testing & CI

- Unit test ada di `src/lib/**/*.test.ts` (Vitest), dijalankan lewat `npm run test`.
- `npm run verify` = typecheck + lint + test, dipakai di CI
  (`.github/workflows/ci.yml`, Node 20 & 22) bersama `npm run build`.

Test menutup logika yang sudah pernah rusak di produksi: pencocokan heading
section (heading bernomor), ekstraksi JSON (pembungkus prosa/tool-call), dan
validasi payload API.

## Struktur Proyek

```
src/
├── app/
│   ├── (auth)/login/          # Login (Supabase / dev-mode)
│   ├── (dashboard)/           # dashboard, new, prd/[id] (+preview, chat), workspace
│   ├── (public)/              # blog, share/[token]
│   ├── api/                   # auth, engines (test), extract, plan, prd (generate/refine/chat/share)
│   ├── layout.tsx, page.tsx   # Root layout + landing
│   └── seo.ts, robots.ts, sitemap.ts
├── components/
│   ├── plan/                  # MindmapCanvas, TaskBoard, StepperHeader
│   ├── prd/                   # SectionCard, ShareExportBar, VersionHistory, dll.
│   ├── shared/                # Logo, Navbar, Footer, Sidebar, ThemeProvider
│   └── ui/                    # shadcn components
├── lib/
│   ├── ai/                    # providers, engine registry, streaming
│   ├── supabase/, auth/       # Client/middleware auth
│   ├── crypto.ts, pdf.ts, constants.ts, utils.ts
└── middleware.ts              # Route guard
prisma/schema.prisma           # Skema DB
```

## Security Notes

- **API key engine terenkripsi at-rest** — AES-256-GCM via `ENGINE_ENC_SECRET`; key tidak pernah dikirim balik ke client setelah disimpan
- **SSRF guard** — custom engine endpoint divalidasi; base URL localhost/private IP diblokir kecuali `ALLOW_LOCAL_AI_ENDPOINTS=true` (untuk self-hosted single-user)
- **Dev-mode auth** — tanpa env Supabase app pakai dev login tanpa session guard; jangan deploy production dalam mode ini
- **Route guard** — `/dashboard`, `/new`, `/prd/*`, `/workspace/*` butuh session aktif begitu Supabase terisi

## License

Belum ditentukan — semua hak dilindungi (all rights reserved) sampai lisensi resmi dipilih.

---

**Author:** Raliq Hidayat BM3
