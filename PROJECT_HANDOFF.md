# MP3 Transcriber — Complete Project Handoff Brief

**Purpose of this document:** Give a new developer (or a fresh Cursor agent context) everything needed to build a **standalone** web app for uploading MP3 files and returning text transcripts — without modifying the existing **Translate** (Burmese–English interpreter) repository.

**Author context:** This brief was written by someone who built and maintains the Translate app. It references Translate only as **read-only inspiration** for patterns, deploy tooling, and STT integrations.

**Last updated:** 2026-05-31

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Hard constraints](#2-hard-constraints)
3. [User stories & success criteria](#3-user-stories--success-criteria)
4. [What Translate already is (do not rebuild this)](#4-what-translate-already-is-do-not-rebuild-this)
5. [What to reuse vs copy vs ignore from Translate](#5-what-to-reuse-vs-copy-vs-ignore-from-translate)
6. [Recommended architecture](#6-recommended-architecture)
7. [Phased delivery plan](#7-phased-delivery-plan)
8. [Repository layout (new project)](#8-repository-layout-new-project)
9. [Frontend specification](#9-frontend-specification)
10. [Backend / API specification](#10-backend--api-specification)
11. [Speech-to-text provider strategy](#11-speech-to-text-provider-strategy)
12. [Handling large files (up to 200 MB)](#12-handling-large-files-up-to-200-mb)
13. [Performance & UX expectations (be honest)](#13-performance--ux-expectations-be-honest)
14. [Deployment & infrastructure](#14-deployment--infrastructure)
15. [Environment variables & secrets](#15-environment-variables--secrets)
16. [Security, abuse prevention, cost control](#16-security-abuse-prevention-cost-control)
17. [Reference implementations in Translate (read-only)](#17-reference-implementations-in-translate-read-only)
18. [Starter code snippets (adapt, do not import)](#18-starter-code-snippets-adapt-do-not-import)
19. [Acceptance tests & smoke checks](#19-acceptance-tests--smoke-checks)
20. [Optional: n8n workflow (for the friend who uses n8n)](#20-optional-n8n-workflow-for-the-friend-who-uses-n8n)
21. [Open questions for stakeholder](#21-open-questions-for-stakeholder)
22. [Appendix A — API contract (OpenAPI-style)](#appendix-a--api-contract-openapi-style)
23. [Appendix B — Example prompts for Gemini fallback](#appendix-b--example-prompts-for-gemini-fallback)
24. [Appendix C — ffmpeg chunking pseudocode](#appendix-c--ffmpeg-chunking-pseudocode)
25. [Appendix D — Cursor agent kickoff prompt](#appendix-d--cursor-agent-kickoff-prompt)

---

## 1. Executive summary

Build a **new, separate** project:

| Attribute | Target |
|-----------|--------|
| **Name (working)** | `mp3-transcriber` |
| **Core job** | User **drags and drops** an MP3 onto the page, picks **English or Afrikaans**, clicks once, gets a text transcript |
| **Primary users** | Non-technical people — zero technical steps, no n8n, no CLI, no “create a workflow” |
| **MVP languages** | **English (`en`)** and **Afrikaans (`af`) only** — these are the two languages that matter |
| **Latency expectation** | Short files (1–3 min): **5–20 seconds**. Long files (1–3 hours): **minutes**, not seconds — UI must reflect this |
| **Build time (experienced dev, reusing patterns below)** | MVP (≤ 25 MB sync): **4–8 hours**. Full 200 MB async: **2–4 days**. Polished v1: **~1 week** |

**Do not** extend the Translate PWA for this. Translate is a **real-time Burmese ↔ English interpreter** (live mic/tab PCM chunks). It has no MP3 upload, no Afrikaans, and a product focus that would be polluted by adding file transcription.

---

## 2. Hard constraints

### Must

- **New git repository** — not a folder inside `Translate/`
- **No changes** to `HannLuus/Translate` unless explicitly requested later
- Support **MP3 upload** (also accept M4A/WAV if trivial — Whisper APIs accept them natively)
- Max upload size target: **200 MB** (may ship in Phase 2; Phase 1 can cap at 25 MB)
- Output: **plain text transcript** (copy button + optional download `.txt`)
- Languages at minimum: **English** and **Afrikaans**
- Works in **modern browser** (Chrome, Edge, Firefox, Safari desktop)
- Mobile-friendly but desktop-first is fine for MVP

### Must not (for MVP)

- User accounts / login (unless stakeholder insists — adds 1–2 days)
- Real-time streaming transcription (that's Translate's domain)
- Translation pipeline (transcribe only; translation is Phase 3 optional)
- TTS / audio playback of results
- Burmese or Translate-specific glossary/terminology logic

### Should

- Reuse **proven patterns** from Translate: Vite + React frontend, Supabase Edge Functions on Deno, Groq Whisper for batch STT, deploy-vps-style rsync
- Clear error messages (file too large, unsupported format, STT provider down)
- Progress indicator for uploads and processing

### Could (later)

- Speaker diarization
- SRT/VTT subtitle export
- Batch folder upload
- n8n webhook trigger integration
- Word doc export

---

## 3. User stories & success criteria

### US-1 — Quick transcript (primary — this IS the product)

> As a user, I **drag and drop** my MP3 file onto the app, choose **English** or **Afrikaans**, press Transcribe, and read/copy the text. That's it.

**UX bar:** If it takes more than 3 clicks or any explanation, it's too complicated.

**Done when:** 3-minute Afrikaans MP3 → transcript in under 30 seconds on a typical connection.

**Visual:** Large drop zone front and center — “Drop your MP3 here” — not buried in menus.

### US-2 — Long recording

> As a user, I upload a 90-minute meeting MP3 (~80 MB) and wait while the app processes it, then I get the full transcript.

**Done when:** App does not crash or timeout; user sees progress; final text is concatenated correctly across chunks.

### US-3 — Language choice is explicit (no guessing games)

> As a user, I know whether my recording is in English or Afrikaans, so I pick one of those two before transcribing.

**Default UI:** Two clear options — **English** | **Afrikaans** (radio buttons or toggle). Auto-detect is optional later, not MVP.

### US-4 — Failure recovery

> As a user, if transcription fails, I see why (file corrupt, too large for sync path, API error) and what to do.

**Done when:** No silent empty results (Translate had issues with this pattern on oversized Groq uploads elsewhere in the ecosystem).

---

## 4. What Translate already is (do not rebuild this)

**Repository:** `git@github.com:HannLuus/Translate.git`

**Product:** Real-time Burmese–English interpreter PWA with three capture modes (tab audio, mic, rooted Android loopback).

**Backend:** Self-hosted Supabase Edge Functions on VPS at:

```
https://translate.lucas-dev-server.tech/functions/v1
```

**Key endpoints (existing — unrelated to this project):**

| Endpoint | Purpose |
|----------|---------|
| `POST /interpret` | Live PCM 16 kHz mono chunk → Burmese STT → English translation |
| `POST /response-audio` | Live English PCM → Burmese translation |
| `POST /clean-and-summarize` | Text cleanup |
| `GET /health` | Health check |

**STT stack in Translate (for reference only):**

- Google Cloud Speech (Chirp) — Burmese + English live
- Groq Whisper — English batch (`supabase/functions/_shared/groqStt.ts`)
- ElevenLabs Scribe — Burmese batch
- Gemini (Vertex) — audio fallback + translation

**Frontend:** `my-interpreter/` — Vite, React, Framer Motion, PWA. Sends **raw PCM**, not files.

**Critical:** Translate's `interpret` endpoint expects **16 kHz mono PCM bytes**, ~0.5 s minimum chunk, **10 MB** body limit on the legacy Node server. None of this applies to MP3 upload.

---

## 5. What to reuse vs copy vs ignore from Translate

### Reuse (same infrastructure patterns, new deployment)

| Pattern | Translate location | Use in new project |
|---------|------------------|-------------------|
| Edge function CORS helper | `supabase/functions/_shared/cors.ts` | Copy & simplify |
| Groq Whisper FormData upload | `supabase/functions/_shared/groqStt.ts` | Copy & generalize language param |
| `fetchWithTimeout` client pattern | `my-interpreter/src/api.ts` | Copy pattern |
| VPS rsync deploy script | `scripts/deploy-vps.sh` | Copy & rename env vars |
| Health + verify scripts | `scripts/verify-vps-deploy.sh` | Copy & adapt |
| Vite dev proxy to `/functions/v1` | `my-interpreter/vite.config.ts` | Same pattern |

### Copy once, then diverge

- Deno `Deno.serve` handler structure from `supabase/functions/health/index.ts`
- `SttResult` type from `supabase/functions/_shared/sttTypes.ts`

### Ignore completely

- `audioCapture.ts`, worklets, wake lock, conversation view
- Burmese Unicode validation, term lock, glossary, scenario profiles
- Gemini Burmese interpret pipeline (`transcribeAndTranslateAudio`)
- ElevenLabs Myanmar keyterms
- Benchmark packs, evidence gates (unless you want QA later)
- PWA offline/interpreter-specific manifest

---

## 6. Recommended architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Vite + React)                                         │
│  - File picker / drag-drop                                      │
│  - Language select: en | af | auto                              │
│  - Upload progress + processing spinner                         │
│  - Transcript display + Copy / Download                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS multipart POST (Phase 1)
                           │ or: POST → Storage URL → job (Phase 2)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Edge Function: POST /transcribe                                │
│  - Validate MIME + size                                         │
│  - Phase 1: sync Groq Whisper (≤ 25 MB)                       │
│  - Phase 2: queue job, ffmpeg chunk, merge                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ Groq       │  │ Gemini     │  │ (Optional) │
    │ Whisper    │  │ audio API  │  │ worker w/  │
    │ large-v3   │  │ fallback   │  │ ffmpeg     │
    └────────────┘  └────────────┘  └────────────┘
```

### Why not pure client-side?

Whisper in browser (WebGPU/wasm) is possible but:
- Heavy download, inconsistent on mobile
- Slower than Groq for most users
- Harder to cap abuse/cost

**Recommendation:** Server-side STT via Groq for MVP.

### Why not reuse Translate's VPS endpoint directly?

- Different product, different CORS origins, different rate limits
- Risk breaking live interpreter
- Translate secrets/billing shouldn't pay for friend's MP3 hobby unless intentional

**Recommendation:** New subdomain + new function folder OR same VPS with **separate** function namespace (e.g. `transcribe.lucas-dev-server.tech`).

---

## 7. Phased delivery plan

### Phase 1 — MVP “it works today” (4–8 hours)

**Scope:**
- New repo `mp3-transcriber`
- Single page UI
- `POST /transcribe` accepts `multipart/form-data` with field `file` + `language`
- Max **25 MB** (Groq direct upload limit)
- Groq Whisper only
- Sync request — user waits on page
- Deploy frontend to Vercel (or similar), backend to VPS edge functions

**Deliverable:** Friend can transcribe typical voice memos and short interviews.

### Phase 2 — Large files up to 200 MB (2–4 days)

**Scope:**
- Client uploads to **presigned storage** OR streams to worker
- Server splits with **ffmpeg** into ~10-minute segments (10 s overlap)
- Transcribe each segment via Groq; merge with overlap dedup
- Async job model: `{ jobId, status, transcript? }`
- Polling or SSE for status

**Why async:** A 200 MB MP3 can be **2–3 hours** of audio → many API calls → edge function timeout (typically 60–150 s).

**Worker options:**
1. **Separate Deno/Node worker** on same VPS with ffmpeg installed (simplest)
2. **Supabase Storage + Edge Function trigger** (if using Supabase cloud)
3. **n8n workflow** triggered by webhook (friend already uses n8n — see §20)

### Phase 3 — Polish (optional, +2–3 days)

- Auth (magic link or API key)
- History of past transcripts (localStorage or DB)
- Translate transcript to other language (Gemini text — not audio)
- SRT export with timestamps (needs Whisper `verbose_json` or similar)

---

## 8. Repository layout (new project)

```
mp3-transcriber/
├── README.md
├── PROJECT_HANDOFF.md          ← this file
├── web/                        ← Vite + React frontend
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       ├── components/
│       │   ├── FileDropzone.tsx
│       │   ├── LanguageSelect.tsx
│       │   ├── TranscriptView.tsx
│       │   └── ProgressBar.tsx
│       └── types.ts
├── supabase/
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts
│       │   ├── groqTranscribe.ts
│       │   └── types.ts
│       ├── health/
│       │   └── index.ts
│       └── transcribe/
│           └── index.ts
├── scripts/
│   ├── deploy-vps.sh
│   └── verify-deploy.sh
└── worker/                     ← Phase 2 only
    ├── package.json
    ├── chunk-and-transcribe.ts
    └── Dockerfile              ← includes ffmpeg
```

**Git remote:** New repo, e.g. `git@github.com:HannLuus/mp3-transcriber.git`

---

## 9. Frontend specification

### Page structure (single route `/`)

**Design principle:** The entire app is essentially one screen — drag, pick language, transcribe. Nothing else on the critical path.

1. **Header** — “MP3 Transcriber” + one line: “Drop an MP3, choose English or Afrikaans, get your transcript.”
2. **FileDropzone (HERO — largest element on page)**
   - Full-width dashed box: **“Drop your MP3 here”** + “or click to browse”
   - Drag-over state: highlight border/background so drop feels responsive
   - Accept: `.mp3` primary; also `.m4a,.wav` if trivial (Whisper accepts them)
   - After drop: show file name + size inside the zone (replace placeholder text)
   - Reject > max size with clear message **before** upload starts
3. **LanguageSelect (required before transcribe)**
   - **Only two options:** `English` | `Afrikaans` — large, obvious toggle or radio pair
   - Maps to API: `en` or `af`
   - No auto-detect in MVP unless stakeholder asks later
4. **Primary button** — “Transcribe” (disabled until file dropped **and** language selected)
5. **Progress**
   - Upload % (XHR/fetch upload progress or `axios`/`fetch` with ReadableStream)
   - Processing state: “Transcribing…” with indeterminate spinner
   - Phase 2: “Processing segment 3 of 12…”
6. **TranscriptView**
   - `<textarea readonly>` or `<pre>` with transcript
   - Buttons: Copy to clipboard, Download `.txt`
   - Show detected language if auto
   - Show elapsed time + word count

### API client (`web/src/api.ts`)

```typescript
const API_BASE = import.meta.env.DEV
  ? '/functions/v1'
  : `${import.meta.env.VITE_API_URL}/functions/v1`;

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY; // if using Supabase gateway

export async function transcribeFile(
  file: File,
  language: 'en' | 'af' | 'auto',
  onUploadProgress?: (pct: number) => void,
): Promise<{ transcript: string; detectedLanguage?: string; durationMs?: number }> {
  const form = new FormData();
  form.append('file', file);
  if (language !== 'auto') form.append('language', language);

  // Use XMLHttpRequest if you need upload progress; fetch doesn't expose it cleanly.

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Transcribe failed (${res.status})`);
  }

  return res.json();
}
```

### Vite proxy (dev)

```typescript
// vite.config.ts
server: {
  proxy: {
    '/functions/v1': {
      target: process.env.VITE_API_URL || 'https://transcribe.example.com',
      changeOrigin: true,
    },
  },
},
```

### UX copy (important)

| Scenario | Message |
|----------|---------|
| File > 25 MB on Phase 1 | “This file is too large for quick transcription (max 25 MB). Full support coming soon — try a shorter clip or compress the MP3.” |
| Processing 10 min audio | “Usually takes 30–90 seconds.” |
| Processing 2 hr audio | “Large file — may take 10–30 minutes. You can leave this tab open.” |
| Empty transcript | “We couldn't detect speech. Check the audio isn't silent or corrupted.” |

### Styling

Keep it **simple**. Translate uses dark theme + Framer Motion — optional. A clean light page with Tailwind or plain CSS is fine. **Don't over-engineer.**

---

## 10. Backend / API specification

### `GET /health`

Same as Translate:

```json
{ "ok": true }
```

### `POST /transcribe` (Phase 1 — synchronous)

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | yes | MP3/M4A/WAV/FLAC/OGG |
| `language` | string | no | `en` or `af`. Omit for auto-detect |

**Success 200:**

```json
{
  "transcript": "Full text here...",
  "detectedLanguage": "af",
  "durationMs": 184000,
  "model": "groq_whisper-large-v3",
  "processingMs": 12340
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{ "error": "No file provided" }` | Missing file |
| 400 | `{ "error": "Unsupported format" }` | Not audio |
| 413 | `{ "error": "File too large (max 25MB)" }` | Phase 1 limit |
| 422 | `{ "error": "No speech detected" }` | Empty transcript |
| 500 | `{ "error": "..." }` | Provider failure |

**Handler outline (`supabase/functions/transcribe/index.ts`):**

1. CORS preflight
2. Parse `multipart/form-data` (use Deno's built-in or `npm:parse-multipart-data`)
3. Validate size & MIME
4. Call `transcribeWithGroq(fileBytes, filename, language?)`
5. Return JSON

**Timeout:** Set client timeout to **120 s** for Phase 1. Configure edge function timeout on VPS if possible.

### `POST /transcribe/jobs` (Phase 2 — async)

**Request:** same multipart OR JSON `{ "storageUrl": "..." }`

**Response 202:**

```json
{
  "jobId": "uuid",
  "status": "queued",
  "pollUrl": "/transcribe/jobs/uuid"
}
```

### `GET /transcribe/jobs/:id`

```json
{
  "jobId": "uuid",
  "status": "processing" | "completed" | "failed",
  "progress": { "current": 3, "total": 12 },
  "transcript": "...",
  "error": null
}
```

---

## 11. Speech-to-text provider strategy

### Primary: Groq Whisper (`whisper-large-v3`)

**Why:** Translate already uses it; fast; accepts MP3 directly; good Afrikaans + English; cheap.

**Limits (as of 2025–2026):**
- Direct upload: **~25 MB** per request (community/docs consensus)
- Paid tier via URL: up to **100 MB** (Groq blog — verify at implementation time)
- Rate limit: ~30 req/min — implement retry with backoff on 429

**API:** `POST https://api.groq.com/openai/v1/audio/transcriptions`

**Reference:** Translate `supabase/functions/_shared/groqStt.ts` — currently hardcodes `language: 'en'` and wraps PCM as WAV. For MP3 upload project: **send the file bytes directly** with original filename extension.

**Afrikaans:** Set `language=af` when user selects Afrikaans. For auto-detect, omit `language` field.

### Fallback: Gemini (Vertex AI) audio

**Why:** Translate uses Gemini for audio fallback; handles many languages; good when Whisper struggles with accent/noise.

**Caveat:** Inline audio size limits (~20 MB effective for inline base64 in many setups). Better for short clips fallback, not 200 MB primary path.

**When to use:** Groq returns empty or confidence low; or Groq 5xx.

### Not recommended for MVP

| Provider | Reason |
|----------|--------|
| Google Chirp (Translate default) | Requires PCM 16 kHz, more setup, tuned for Burmese in existing code |
| ElevenLabs Scribe | Translate uses for Myanmar; overkill for en/af |
| OpenAI Whisper direct | Similar to Groq but Translate team already standardized on Groq |
| Client-side whisper.cpp | Large WASM, support burden |

---

## 12. Handling large files (up to 200 MB)

### The problem

| Constraint | Detail |
|------------|--------|
| Groq upload | ~25 MB per API call |
| Edge function timeout | Often 60–150 s |
| 200 MB MP3 @ 128 kbps | ~3.5 hours audio |
| User expectation | “Few seconds” is **only** valid for short clips |

### Solution: chunk → transcribe → merge

1. **Store original file** (temp disk or object storage)
2. **ffmpeg** probe duration
3. Split into **600 s (10 min)** segments with **10 s overlap**
4. For each segment, call Groq Whisper
5. **Merge transcripts:** deduplicate overlap region (simple: split on words, fuzzy match last N words of chunk N with first N words of chunk N+1)
6. Return full text

**Groq official guidance:** [Audio chunking tutorial](https://github.com/groq/groq-api-cookbook) — 10-minute chunks, 10 s overlap.

**Where ffmpeg runs:** NOT inside a tiny edge function if avoidable. Use a **worker container** on the VPS:

```dockerfile
FROM denoland/deno:alpine
RUN apk add --no-cache ffmpeg
# ...
```

### Alternative: preprocess client-side

Browser ffmpeg.wasm can downsample/compress before upload — reduces bandwidth but adds client complexity and still won't beat 25 MB Groq limit without chunking server-side.

**Recommendation:** Server-side chunking in Phase 2 worker.

---

## 13. Performance & UX expectations (be honest)

Set stakeholder expectations explicitly:

| Audio length | Approx file size (128 kbps MP3) | Expected processing time |
|--------------|--------------------------------|--------------------------|
| 1 min | ~1 MB | 5–15 s |
| 5 min | ~5 MB | 15–45 s |
| 30 min | ~30 MB | 2–5 min (requires chunking) |
| 2 hours | ~120 MB | 10–25 min |
| 3+ hours | ~200 MB | 20–40 min |

**Upload time** depends on user's uplink — show upload progress separately from STT processing.

---

## 14. Deployment & infrastructure

### Option A — Mirror Translate setup (recommended for Hann's team)

| Layer | Choice |
|-------|--------|
| Frontend | Vercel (new project, new domain e.g. `mp3-transcribe.vercel.app`) |
| Backend | Self-hosted Supabase Edge Functions on Hetzner VPS (same *pattern* as Translate, **separate deploy path**) |
| Secrets | `GROQ_API_KEY` on VPS env for edge runtime |

**Deploy script:** Copy `Translate/scripts/deploy-vps.sh`, change:
- `TRANSLATE_VPS_HOST` → `TRANSCRIBE_VPS_HOST`
- Source path → this repo's `supabase/functions/`
- Remote path → e.g. `/home/deno/functions-transcribe/` (separate from Translate!)

**Verify script:** Hit `GET /health` on new base URL.

### Option B — Supabase Cloud (simpler ops, separate billing)

- New Supabase project
- `supabase functions deploy transcribe`
- Storage bucket for Phase 2
- No SSH/rsync

### Option C — All-in-one Node server (fastest hack)

Single Express/Fastify server with `multer` + Groq SDK. Deploy on same VPS different port. **Fine for MVP** if edge functions feel heavy.

### DNS

New subdomain suggested: `transcribe.lucas-dev-server.tech` — **do not** reuse `translate.lucas-dev-server.tech` routes without namespacing (avoid breaking `/interpret`).

### CORS

Allow origins:
- `http://localhost:5173` (dev)
- Production Vercel URL

Copy CORS helper from Translate; **remove** Translate-specific headers (`x-term-lock`, `x-meeting-context`, etc.).

---

## 15. Environment variables & secrets

### Edge functions / worker (server)

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | yes | Groq API key |
| `GROQ_MODEL` | no | Default `whisper-large-v3` |
| `MAX_UPLOAD_BYTES` | no | Phase 1: `26214400` (25 MB) |
| `MAX_UPLOAD_BYTES_PHASE2` | no | `209715200` (200 MB) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | no | Only if Gemini fallback enabled |
| `VERTEX_AI_REGION` | no | e.g. `us-central1` |
| `GEMINI_MODEL` | no | e.g. `gemini-2.0-flash` |

### Frontend (Vite — public)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base, e.g. `https://transcribe.lucas-dev-server.tech` |
| `VITE_SUPABASE_ANON_KEY` | If using Supabase API gateway |

**Never** expose `GROQ_API_KEY` in frontend.

---

## 16. Security, abuse prevention, cost control

MP3 transcription is **spam/abuse prone** (public endpoint + GPU cost).

### MVP minimum

- **Rate limit** by IP: e.g. 10 transcriptions / hour (use KV, Redis, or in-memory on single VPS)
- **Max file size** enforced server-side (don't trust client)
- **MIME sniffing** — check magic bytes, not just extension
- **CORS** restricted to known frontend origins (not `*` in production if credentials used)

### Before going public

- Optional API key or simple password gate
- Daily spend cap alert on Groq dashboard
- Log `processingMs`, `fileSizeBytes`, `clientIp` (hashed) for monitoring

### Cost rough estimate (Groq Whisper)

~$0.003–0.006 per minute of audio (verify current Groq pricing). A 2-hour file ≈ **$0.40–0.75** per transcription.

---

## 17. Reference implementations in Translate (read-only)

**Do not import across repos.** Read these files in `HannLuus/Translate`:

| File | What to learn |
|------|---------------|
| `supabase/functions/_shared/groqStt.ts` | Groq FormData upload, WAV wrapping (skip WAV wrap for MP3) |
| `supabase/functions/_shared/cors.ts` | CORS preflight |
| `supabase/functions/health/index.ts` | Minimal Deno handler |
| `my-interpreter/src/api.ts` | `fetchWithTimeout`, apikey headers, error parsing |
| `scripts/deploy-vps.sh` | rsync deploy to VPS |
| `scripts/verify-vps-deploy.sh` | post-deploy smoke test |

**Translate backend URL rule (for their project, not yours):** Single source of truth is `my-interpreter/src/api.ts` — **do not** coupling to that in the new app.

---

## 18. Starter code snippets (adapt, do not import)

### Generalized Groq transcribe (Deno)

```typescript
// supabase/functions/_shared/groqTranscribe.ts
import type { SttResult } from './types.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function transcribeWithGroq(
  audioBytes: Uint8Array,
  filename: string,
  language?: 'en' | 'af',
): Promise<SttResult & { detectedLanguage?: string }> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey?.trim()) throw new Error('GROQ_API_KEY not configured');

  const model = Deno.env.get('GROQ_MODEL') ?? 'whisper-large-v3';
  const mime = guessMime(filename);

  const form = new FormData();
  form.append('model', model);
  form.append('response_format', 'verbose_json'); // timestamps optional Phase 3
  form.append('file', new Blob([audioBytes], { type: mime }), filename);
  if (language) form.append('language', language);

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq STT ${res.status}: ${err}`);
  }

  const data = await res.json() as { text?: string; language?: string };
  const transcript = (data.text ?? '').trim();

  return {
    transcript,
    confidence: transcript ? 0.9 : 0,
    alternatives: [],
    model: `groq_${model}`,
    detectedLanguage: data.language,
  };
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}
```

### Transcribe handler skeleton

```typescript
// supabase/functions/transcribe/index.ts
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { transcribeWithGroq } from '../_shared/groqTranscribe.ts';

const MAX_BYTES = Number(Deno.env.get('MAX_UPLOAD_BYTES') ?? 25 * 1024 * 1024);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const started = Date.now();

  try {
    const form = await req.formData();
    const file = form.get('file');
    const langRaw = form.get('language');

    if (!(file instanceof File)) {
      return json({ error: 'No file provided' }, 400);
    }

    if (file.size > MAX_BYTES) {
      return json({ error: `File too large (max ${MAX_BYTES} bytes)` }, 413);
    }

    const language = langRaw === 'en' || langRaw === 'af' ? langRaw : undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await transcribeWithGroq(bytes, file.name, language);

    if (!result.transcript) {
      return json({ error: 'No speech detected' }, 422);
    }

    return json({
      transcript: result.transcript,
      detectedLanguage: result.detectedLanguage,
      model: result.model,
      processingMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[transcribe]', err);
    const msg = err instanceof Error ? err.message : 'Transcribe failed';
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

---

## 19. Acceptance tests & smoke checks

### Manual test matrix

| # | Input | Language | Expected |
|---|-------|----------|----------|
| 1 | 30 s English MP3 | en | Transcript in English, < 20 s |
| 2 | 30 s Afrikaans MP3 | af | Transcript in Afrikaans |
| 3 | Mixed/unknown | auto | Reasonable transcript + detectedLanguage |
| 4 | Silent MP3 | en | 422 or empty with clear error |
| 5 | 30 MB file | en | Phase 1: 413 with helpful message |
| 6 | Corrupt file | en | 400/500 with error message |
| 7 | PDF renamed .mp3 | en | 400 unsupported format |

### Automated smoke (`scripts/verify-deploy.sh`)

```bash
API_BASE="${TRANSCRIBE_API_BASE:-https://transcribe.example.com/functions/v1}"
curl -sf "${API_BASE}/health" | grep -q '"ok":true'
# Optional: curl -F "file=@fixtures/sample-en.mp3" -F "language=en" "${API_BASE}/transcribe"
```

### Regression guard

- Transcript must **never** silently return 200 with empty string without explanation
- Upload size validated **before** calling Groq (save API cost)

---

## 20. Optional: n8n workflow (for the friend who uses n8n)

If the friend prefers n8n over a custom web UI, provide this **after** the API exists:

```
Webhook (POST multipart)
  → HTTP Request: POST /transcribe to your backend
  → Set node: extract transcript
  → Google Docs / Email / Notion / Slack
```

For **200 MB** via n8n:
- Webhook receives file → **Write to disk/S3** → HTTP trigger worker `/jobs` → Poll until complete

n8n is **orchestration**, not a substitute for chunking logic on the server.

---

## 21. Open questions for stakeholder

Answer these before Phase 2:

1. **Auth required?** Public tool vs friends-only?
2. **Billing:** Who pays Groq API costs?
3. **Domain:** New subdomain OK? Who manages DNS?
4. **Same VPS as Translate?** OK if isolated function path + separate env?
5. **Afrikaans only, English only, or both + auto?**
6. **Translation needed?** (Afrikaans audio → English text is translation, not transcription)
7. **Retention:** Store uploaded MP3s or delete immediately after STT?
8. **GDPR/privacy:** Any POPIA considerations (South Africa)?

---

## Appendix A — API contract (OpenAPI-style)

```yaml
openapi: 3.0.0
info:
  title: MP3 Transcriber API
  version: 0.1.0
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
  /transcribe:
    post:
      summary: Transcribe audio file (sync, Phase 1)
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
                language:
                  type: string
                  enum: [en, af]
      responses:
        '200':
          description: Transcript ready
          content:
            application/json:
              schema:
                type: object
                properties:
                  transcript:
                    type: string
                  detectedLanguage:
                    type: string
                  processingMs:
                    type: integer
        '413':
          description: File too large
        '422':
          description: No speech detected
```

---

## Appendix B — Example prompts for Gemini fallback

Only if Groq fails and file is small enough for inline audio:

```
Listen to this audio. Transcribe exactly what is spoken.
If the language is Afrikaans, output Afrikaans text.
If English, output English text.
Do not translate unless asked.
Output plain text only, no markdown.
```

---

## Appendix C — ffmpeg chunking pseudocode

```typescript
async function transcribeLargeFile(filePath: string, language?: 'en' | 'af') {
  const chunkSec = 600;
  const overlapSec = 10;
  const segments = await ffmpegSegment(filePath, chunkSec, overlapSec);
  const parts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const bytes = await Deno.readFile(segments[i]);
    const result = await transcribeWithGroq(bytes, `chunk-${i}.mp3`, language);
    parts.push(result.transcript);
    // update job progress: i+1 / segments.length
  }

  return mergeOverlappingTranscripts(parts, overlapSec);
}
```

---

## Appendix D — Cursor agent kickoff prompt

Copy everything below into a **new Cursor chat** with an empty repo (or after `mkdir mp3-transcriber && git init`):

---

**PROMPT START**

You are building a **new standalone project** called `mp3-transcriber`. Read the full specification in `PROJECT_HANDOFF.md` in the repo root.

**The product in one sentence:** Drag-and-drop an MP3 → pick English or Afrikaans → get transcript. Must feel dead simple for non-technical users.

**Critical rules:**
1. Do **NOT** modify or depend on the `Translate` repository (Burmese–English interpreter).
2. Phase 1 only: sync transcription via Groq Whisper, max 25 MB MP3 upload, **English and Afrikaans only**.
3. **Drag-and-drop is the primary upload method** — large drop zone, not a hidden file input.
4. Stack: Vite + React frontend, Deno Supabase Edge Functions backend, deploy frontend to Vercel, backend via `scripts/deploy-vps.sh` pattern.

**Your tasks (in order):**
1. Scaffold repo per §8 layout
2. Implement `GET /health` and `POST /transcribe` per §10
3. Copy/adapt Groq integration from §18 (send MP3 directly, do not PCM→WAV unless needed)
4. Build single-page UI per §9 (drag-drop, language select, copy transcript)
5. Add `scripts/verify-deploy.sh` smoke test
6. Write README with env vars and local dev instructions

**Reference code (read-only, sibling repo):** `/home/hann/projects/Translate/supabase/functions/_shared/groqStt.ts` — adapt for MP3 + language param.

**Out of scope for this session:** Phase 2 async/200MB, auth, translation, n8n.

When done, run frontend build and verify health endpoint works locally or against staging.

**PROMPT END**

---

*End of handoff document.*
