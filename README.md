# Listen Together

Shared audiobook rooms: upload an `.m4b`, listen in sync, and save bookmarks to resume later.

- **`web/`** — Next.js UI (deploy on **Vercel**)
- **`worker/`** — Cloudflare Worker + D1 + R2 + Durable Objects (data, files, realtime)

## Architecture

```
Browser  →  Vercel (Next.js UI)
Browser  →  Cloudflare Worker (REST + audio stream)
Browser  →  Durable Object WebSocket (play / pause / seek sync)
Worker   →  D1 (rooms, bookmarks)
Worker   →  R2 (.m4b storage)
```

Large files upload in **8MB chunks** through the Worker into an R2 multipart upload (no S3 API keys required).

## Prerequisites

- Node.js 20+
- Cloudflare account with **R2** (your existing bucket is fine) and **D1**
- Vercel account + GitHub repo (recommended for redeploys)

## 1. Cloudflare setup

### Create D1 database

```bash
cd worker
npx wrangler login
npx wrangler d1 create audio-listening
```

Copy the `database_id` into [`worker/wrangler.toml`](worker/wrangler.toml).

### Point R2 bucket

In `worker/wrangler.toml`, set `bucket_name` under `[[r2_buckets]]` to your existing R2 bucket name.

### Apply migrations

```bash
# local (for wrangler dev)
npm run db:migrate:local

# production
npm run db:migrate:remote
```

### CORS

Set `CORS_ORIGIN` in `wrangler.toml` `[vars]` (local) and again for production to your Vercel URL, e.g. `https://your-app.vercel.app`.

### Deploy worker

```bash
cd worker
npm install
npm run deploy
```

Note the `*.workers.dev` URL (or custom domain). That becomes `NEXT_PUBLIC_WORKER_URL`.

## 2. Local development

Terminal A — Worker (local Worker + Durable Objects; real R2/D1 via `remote = true` in wrangler.toml):

```bash
cd worker
npm install
npm run db:migrate:remote
npm run dev
```

Terminal B — Web:

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Worker defaults to [http://localhost:8787](http://localhost:8787).

## 3. Deploy frontend to Vercel (GitHub workflow)

This is the recommended path so **every `git push` redeploys** automatically.

1. Create a GitHub repo and push this project.
2. In Vercel → **Add New Project** → import the GitHub repo.
3. Set **Root Directory** to `web`.
4. Add environment variable:
   - `NEXT_PUBLIC_WORKER_URL` = `https://your-worker.workers.dev` (no trailing slash)
5. Deploy.

### How redeploys work

| What changed | What you do |
|---|---|
| UI / Next.js code | `git push` → Vercel auto-redeploys |
| Worker / D1 / R2 logic | `cd worker && npm run deploy` |
| Env vars | Update in Vercel or `wrangler.toml` / Worker secrets, then redeploy that side |

You do **not** need to re-upload the site manually for normal code changes once GitHub ↔ Vercel is connected.

## 4. wrangler.toml checklist

Replace placeholders:

- `database_id` — from `wrangler d1 create`
- `bucket_name` — your R2 bucket
- `CORS_ORIGIN` — local `http://localhost:3000`, then your Vercel URL in production

For production CORS after Vercel is live, either:

```bash
cd worker
npx wrangler secret put CORS_ORIGIN
# paste https://your-app.vercel.app
```

…or set `[vars] CORS_ORIGIN` and redeploy. If both exist, prefer keeping production origin in vars for simplicity on a personal project.

## Usage

1. Upload `.m4b` files into your R2 bucket under **`AudioBooks/`** (Cloudflare dashboard)
2. On the home page, **select that file** → Create room → share the code
3. Play / pause / seek stays in sync for everyone in the room
4. Bookmarks and last position are saved **per book file**, so they return next session

## Scripts

| Command | Where | Purpose |
|---|---|---|
| `npm run dev` | `web/` | Next.js local |
| `npm run dev` | `worker/` | Worker local |
| `npm run deploy` | `worker/` | Deploy Worker |
| `npm run db:migrate:remote` | `worker/` | Apply D1 migrations in prod |

## Notes

- `.m4b` is served as `audio/mp4`. No conversion needed for most browsers.
- Audio streams from the Worker with HTTP Range support (seek without downloading the whole file first).
- v1 uses guest nicknames only (no accounts).
