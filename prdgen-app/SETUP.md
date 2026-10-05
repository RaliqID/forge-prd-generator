# Setup — FORGE (AI PRD Generator)

Panduan instalasi lokal yang jujur: **app TIDAK zero-config**. Tanpa env tertentu, generate PRD akan gagal. Ikuti langkah di bawah.

## Prasyarat

- **Node.js 20+**
- **PostgreSQL 17** (install lokal) **atau akun Supabase** (Postgres terkelola + auth)
- API key AI provider — lihat bagian [AI Provider](#ai-provider) di bawah

## 1. Install & Env

```bash
npm install
cp .env.example .env.local
```

Buka `.env.local` dan isi:

| Wajib | Variabel | Keterangan |
|-------|----------|------------|
| ✅ | `DATABASE_URL`, `DIRECT_URL` | Postgres lokal atau Supabase (pooler 6543 / direct 5432) |
| ✅ | `ENGINE_ENC_SECRET` | `openssl rand -base64 48` — enkripsi key engine tersimpan |
| 🔶 | `NINE_ROUTER_API_KEY` (+ `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_MODEL`) | AI generation |
| 🔶 | Supabase (`NEXT_PUBLIC_SUPABASE_URL` + 2 key lain) | Auth asli; kosong = dev-mode |

✅ wajib · 🔶 salah satu jalur AI/auth

## 2. Database

```bash
npm run db:push       # push schema langsung (paling cepat)
# atau
npm run db:migrate    # bikin migrasi SQL ter-track
npm run db:studio     # (opsional) lihat isi DB di browser
```

## 3. AI Provider

**Default & direkomendasikan — 9Router lokal:**

1. Jalankan proxy 9Router lokal (`http://localhost:20128/v1`, model `Dev-Stack`)
2. Isi di `.env.local`:
   ```env
   NINE_ROUTER_API_KEY=key-anda
   NINE_ROUTER_BASE_URL=http://localhost:20128/v1
   NINE_ROUTER_MODEL=Dev-Stack
   ```

**Alternatif opsional:**

- **AgentRouter** — `AGENTROUTER_API_KEY` (model fixed: `claude-opus-4-8`, https://agentrouter.org)
- **OpenRouter** — `OPENROUTER_API_KEY` (1 key → semua model GPT/Claude/Gemini/Kimi/DeepSeek/Qwen, https://openrouter.ai/keys)

Fallback otomatis: 9Router → AgentRouter → OpenRouter (key pertama yang terisi dipakai).

## 4. Supabase Auth (opsional tapi disarankan)

App jalan lokal **tanpa Supabase** via dev login (auth dev-mode). Tapi fitur auth asli + route guard hanya aktif kalau env Supabase terisi:

1. Buat project di https://supabase.com
2. **Project Settings → API** → salin `Project URL` + `anon key` + `service_role key`
3. Isi `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxx
   SUPABASE_SERVICE_ROLE_KEY=xxxx
   ```

> ⚠️ **Tanpa env Supabase, app jalan dalam dev-mode auth**: middleware membiarkan request lolos tanpa session — TIDAK untuk production. Mengisi env Supabase otomatis mengaktifkan auth asli + guard.

## 5. Jalankan

```bash
npm run dev          # http://localhost:5555
```

## Deployment

- Set `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` ke domain produksi
- **Wajib** isi env Supabase (auth asli + guard), `ENGINE_ENC_SECRET`, dan kredensial AI provider
- Jangan set `ALLOW_LOCAL_AI_ENDPOINTS=true` di production (buka SSRF via localhost)

---

*Penulis: Raliq Hidayat BM3*
