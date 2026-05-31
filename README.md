# MP3 Transcriber

A simple PWA: **drop an MP3 → choose English or Afrikaans → get a transcript.**

- **Frontend:** Vite + React + PWA (`vite-plugin-pwa`)
- **Backend:** One Vercel serverless route that calls [Groq Whisper](https://groq.com/) (API key stays on the server)
- **Large files (up to 200 MB):** Split in the browser with ffmpeg.wasm, then transcribe each part

See [PROJECT_HANDOFF.md](./PROJECT_HANDOFF.md) for full product context.

## Quick start (local)

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env.local` and set:

```bash
GROQ_API_KEY=your_groq_key_here
```

### 3. Run API + frontend

You only **open** http://localhost:5173 in the browser — but transcription needs the **API on port 3000** in the background (Vite proxies `/api` there).

**Easiest — one terminal:**

```bash
npm run dev:all
```

Then open http://localhost:5173

**Or two terminals:**

| Terminal | Command | What it does |
|----------|---------|----------------|
| A | `npm run dev:api` | API on port 3000 (you never need to open this in the browser) |
| B | `npm run dev` | UI on port 5173 |

**Or skip 5173 entirely** — run only `npm run dev:api` and open http://localhost:3000 (Vercel serves UI + API together).

### 4. Build

```bash
npm run build
```

## Deploy (Vercel)

1. Push to GitHub and import the repo in [Vercel](https://vercel.com).
2. Framework preset: **Vite**
3. Add environment variable: `GROQ_API_KEY`
4. Deploy — frontend and `/api/*` share the same origin (no extra `VITE_API_URL` needed).

Optional: `GROQ_MODEL` (default `whisper-large-v3`), `MAX_UPLOAD_BYTES` (default 25 MB per API request).

## How it works

| File size | Flow |
|-----------|------|
| ≤ ~4 MB | One upload → `/api/transcribe` → Groq |
| > ~4 MB | ffmpeg.wasm splits (~10 min segments, 10 s overlap) → sequential `/api/transcribe` per chunk → merge in browser |

**Limits**

- Max file: **200 MB** (client-side check)
- Max per API request: **25 MB** (Groq); chunks are kept smaller for Vercel body limits (~4.5 MB on Hobby)

**Expectations**

| Audio length | Rough processing time |
|--------------|------------------------|
| 1–3 min | 5–20 s |
| ~30 min | 2–5 min |
| 2+ hours | 10–30+ min |

Large files work best on **desktop Chrome or Edge**.

## Smoke tests

After deploy, run:

```bash
./scripts/verify-deploy.sh
```

Manual checks (see PROJECT_HANDOFF §19):

1. Short English MP3 (&lt; 4 MB) → transcript in under ~30 s
2. Short Afrikaans MP3 → Afrikaans text
3. Large file (&gt; 50 MB) → progress “part X of Y”, full merged transcript
4. Silent/corrupt file → clear error (not empty 200)
5. PWA installable from browser menu

## Project layout

```
api/health.ts          GET health check
api/transcribe.ts      POST multipart → Groq
src/App.tsx            Single-page UI
src/chunkAudio.ts      ffmpeg.wasm splitting
src/mergeTranscripts.ts Overlap merge
src/transcribeJob.ts   Orchestration
```

## License

Private / use as you like.
