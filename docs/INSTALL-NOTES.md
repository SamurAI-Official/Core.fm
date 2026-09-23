<!--
  The engineering record for Core.fm: what was built, what was measured, and what is still open.
  Versioned with the code it describes. The working copy lives one level above the repos
  (G:\Program Prototype\SafetyNet\INSTALL-NOTES.md); this is a copy taken from it, and the two are
  updated together.
-->

# Core.fm — local install notes (Windows)

**Repository: <https://github.com/SamurAI-Official/Core.fm>** — `main` is the app, `signal-aggregator` is the
trend-intelligence loop, `ace-step-1.5-patches` is the engine with our patches (see §17.21). `ace-step` is the
project the engine was forked from, never a push target.

Installed: 2026-09-18 on `G:\Program Prototype\SafetyNet`

## Layout

```
G:\Program Prototype\SafetyNet\
├─ ace-step-ui\            ← Core.fm: frontend + backend (forked from fspecii/ace-step-ui @ a1fdf91)
│  ├─ server\              ← Express/tsx API (3001), SQLite
│  └─ signal-aggregator\   ← the loop, vendored as a git subtree from Core.fm's `signal-aggregator` branch
├─ signal-aggregator\      ← the loop's own checkout (3002), same commits as the subtree above
├─ ACE-Step-1.5\           ← AI engine, Windows portable package (@ 1b62344 + 6 Core.fm patches)
│  ├─ python_embeded\      ← bundled Python 3.11.9 + torch 2.7.1+cu128
│  └─ checkpoints\         ← 10.68 GB of models (downloaded on first run)
├─ _downloads\             ← ACE-Step-1.5.7z (2.24 GB) — safe to delete to reclaim space
├─ _logs\                  ← service logs
└─ INSTALL-NOTES.md        ← this file (a copy is versioned at ace-step-ui/docs/INSTALL-NOTES.md)
```

The engine **must** stay a sibling of `ace-step-ui`, because `start-all.bat`
defaults to `ACESTEP_PATH=..\ACE-Step-1.5` and the backend defaults LoRA datasets to
`<repo>\..\ACE-Step-1.5\datasets`. `ACESTEP_PATH` is also set as a user env var.

## Ports

| Service | URL | Start command |
|---|---|---|
| Frontend (Vite) | http://localhost:3000 | `npm run dev` (repo root) |
| Backend (Express/tsx) | http://localhost:3001 | `npm run dev` (in `server\`) |
| Loop (signal-aggregator) | http://localhost:3002 | `npx tsx src/index.ts serve --schedule` (in `signal-aggregator\`) |
| Engine (Gradio + REST API) | http://localhost:8001 | see below |

## Start / stop

**One click:** double-click `ace-step-ui\start-all.bat` (opens 3 terminals + browser).

**Manual (3 terminals):**

```bat
REM 1) Engine — Gradio server WITH API enabled (required)
cd /d "G:\Program Prototype\SafetyNet\ACE-Step-1.5"
python_embeded\python acestep\acestep_v15_pipeline.py --port 8001 --enable-api --backend pt --server-name 127.0.0.1

REM 2) Backend
cd /d "G:\Program Prototype\SafetyNet\ace-step-ui\server"
npm run dev

REM 3) Frontend
cd /d "G:\Program Prototype\SafetyNet\ace-step-ui"
npm run dev
```

Close the three terminal windows to stop everything.

## Local patches applied (2 files, both intentional)

1. **`ace-step-ui\server\src\services\acestep.ts`** — removed the `isFormatCaption`
   value from the Gradio argument list in `buildGradioArgs()`. ACE-Step 1.5 exposes
   `is_format_caption_state` as a Gradio **State** component, so it is not part of
   `/generation_wrapper`'s API arguments. Sending it shifted every following argument
   by one position and the engine rejected every job with
   `Value False is less than minimum value 0.01.` (`getLrc` was landing on `score_scale`).
   **A `git pull` of the upstream repo may reintroduce this bug.**

2. **`ace-step-ui\start-all.bat`** — the engine command was changed from the REST-only
   `api_server.py` / `acestep-api` (which does **not** expose `/gradio_api/*`) to the
   Gradio pipeline with `--enable-api --backend pt`. Without this, the UI reports
   "ACE-Step not reachable" and generation always fails.

## Also installed / changed on the machine

- **FFmpeg 9.0.1** (winget `Gyan.FFmpeg`, full build). Required by the backend's
  `getAudioDuration()` which shells out to `ffprobe`; without it songs show `0:00`.
  It was added to the user PATH — **restart VS Code / terminals** so new processes see it.
- `ACESTEP_PATH` user env var → `G:\Program Prototype\SafetyNet\ACE-Step-1.5`.
- `ACE-Step-1.5\.env`: `ACESTEP_LM_BACKEND=pt` (vllm is Linux-only) and
  `ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B` (safe for the 12 GB RTX 4070 Ti).
- `ace-step-ui\.env` + `ace-step-ui\server\.env`: created from the examples with
  `FRONTEND_URL=http://localhost:3000` (the example ships `5173`, which is wrong).

## Signal aggregator (added 2026-09-18)

`signal-aggregator\` — country-level music trend aggregation plus a
design → generate → market-test → learn loop that drives the pipeline above.

- Ports: dashboard/API on **3002**; it calls the ace-step-ui backend on 3001.
- Start: `SignalNet\start-aggregator.bat` (or `cd signal-aggregator && npm run serve`).
- First run: `npm install`, then `npm run collect`, `npm run brief`, `npm run design`.
- Full loop: `npm run cycle -- --generate 2`  (collect → brief → design → render → score).
- Rate songs (the market test): `npm run rate -- --run <runId> --score 0.8`.
- Data: `signal-aggregator\data\signals.db` (SQLite) + `data\audio\<market>\` renders.
- Details, scoring rules and limitations: `signal-aggregator\README.md`.

Note: with `npm run`, CLI arguments must come after `--`. Under PowerShell the flags
can be swallowed, so `npx tsx src/index.ts <command> ...` is the reliable form.

- Backend booted, SQLite migrations ran, `server\data\acestep.db` created.
- Frontend served HTTP 200 (`index.html`, `App.tsx`, `index.css`).
- `GET http://127.0.0.1:3001/api/generate/health` → `{"healthy":true,"aceStepUrl":"http://localhost:8001"}`.
- Engine loaded `acestep-v15-turbo` (DiT) + `acestep-5Hz-lm-0.6B` (LM, PyTorch/CUDA, tier4).
- **Real generation test:** 15 s instrumental via the UI's own service layer →
  valid MP3 (`ffprobe`: `duration=15.000000`, `format_name=mp3`, 133 kbps).

## Caveats

- **Hardware:** RTX 4070 Ti, 12 GB VRAM → keep batch size 1, use the `turbo` DiT and the
  0.6B LM. The XL (4B) DiT models need ≥12 GB *with* CPU offload (≥20 GB recommended).
- **First run downloads ~10.7 GB of models**; the main bundle also pulls
  `acestep-5Hz-lm-1.7B` (unused while `.env` selects 0.6B — delete
  `checkpoints\acestep-5Hz-lm-1.7B` if you want the ~3.4 GB back).
- `server\src\services\acestep.ts` has a **Python-spawn fallback** that expects
  `ace-step-ui\ACE-Step-1.5\env\Scripts\python.exe` (an in-repo clone with an `env`
  venv). That fallback cannot work with this layout — it is only used when the Gradio
  server is unreachable, so keep port 8001 up.
- Windows has no `vllm`; always pass `--backend pt`.
- Optional features: `GEMINI_API_KEY` in `.env` powers "AI Enhance"; `PEXELS_API_KEY`
  enables video backgrounds. Both are blank by default.
- LAN access from other devices needs firewall rules for TCP 3000/3001.

---

## Trend Intelligence in the UI (added 2026-09-18)

The signal aggregator is now driven from inside the ACE-Step UI:
**sidebar → Trends** (`http://localhost:3000`), backed by the aggregator on 3002.

```
browser ──/aggregator/*──► Vite proxy ──► aggregator :3002 ──► ace-step-ui :3001 ► ACE-Step :8001
```

What it lets you do: pick markets, `Collect signals` / `Design songs` /
`Run full cycle`, see each nation's genre mix, tempo and momentum, then **augment
any design** (title, style prompt, BPM, key, meter, duration, language, lyrics)
and render it. Every render gets an inline player and a 0.2–1.0 rating strip; a
rating re-scores the song and shows the market weight deltas it applied.

Both services must be running: `ace-step-ui` (3000/3001/8001) plus
`start-aggregator.bat` (3002). The view says so plainly if either is down.

### UI-side files touched

| File | Change |
|---|---|
| `components/TrendsView.tsx` | New: trigger panel, market cards, augmentation editor, ratings, report modal |
| `services/aggregator.ts` | New: typed aggregator client (relative URLs through the proxy) |
| `types.ts` | `View` gains `'trends'` |
| `components/Sidebar.tsx` | Nav entry (TrendingUp icon) |
| `App.tsx` | `import` + `case 'trends'` rendering `TrendsView` |
| `vite.config.ts` | `/aggregator` proxy → `AGGREGATOR_URL` (default `http://127.0.0.1:3002`) |
| `i18n/translations.ts` | `trends` label for en/zh/ja/ko |
| `.env` | `AGGREGATOR_URL=http://127.0.0.1:3002` |

### Third local patch to ace-step-ui

`server/src/services/acestep.ts` — in `processGeneration()`, a failure **after**
Gradio was confirmed reachable no longer falls through to the Python-spawn path.
That path points at `ace-step-ui\ACE-Step-1.5\env\Scripts\python.exe` (an in-repo
clone with an `env` venv) which does not exist in this portable layout, so it hid
the real cause — engine crash, rejected argument, hung job — behind a confusing
`spawn ... ENOENT`. The real cause is now reported as
`ACE-Step generation failed: <cause>`. The spawn fallback still runs when Gradio was
never available at all (the original intent).

### Aggregator-side additions for the UI

- `GET /api/concepts`, `GET /api/concepts/:id`, `PATCH /api/concepts/:id` (edit a design)
- `POST /api/concepts/:id/run` — starts a render and returns a run id immediately;
  the body may carry `{ patch }` so the UI's edits are applied first
- `GET /api/runs/:id`, plus `audioFiles` URLs on every run (served from `data/audio`)
- `runs.stage` column so progress is persisted while the GPU works
- CORS mirroring the UI's localhost/LAN policy
- `scripts/reconcile-runs.ts` — marks runs orphaned by an aggregator restart as failed

### Known operational caveats

- **The ACE-Step engine is the fragile part.** It died once mid-render during
  quantized CPU/GPU offload churn (native crash, no traceback), and one Gradio job
  hung after the engine had already written audio into
  `ACE-Step-1.5\gradio_outputs`. Symptom: the UI shows "running" indefinitely.
  Recovery: restart the engine, then `npx tsx scripts/reconcile-runs.ts`.
  For long unattended cycles keep `THINKING` off and durations short.
- A render holds the single GPU for roughly 2–5 minutes; the Trends view polls and
  keeps the stage visible, and the run list is the source of truth.
- Vite must be restarted after `vite.config.ts` changes (the proxy is read at
  startup). Only one backend supervisor may hold port 3001 — if you see
  `EADDRINUSE`, kill stray `node` processes before restarting.
---

## Lyric generator now writes to a songwriting arc (2026-09-18)

`signal-aggregator/src/design/` — the lyric scaffold is no longer assembled from
loose banks; it is written to one narrative arc:

```
perspective -> uncertainty -> agency -> contradiction ->
concrete metaphor -> scale expansion -> unresolved or reframed conclusion
```

| File | Role |
|---|---|
| `arc.ts` | The seven stages, their craft intent, and the energy-dependent section map |
| `lyricBanks.ts` | Typed phrase banks (each entry written for exactly one template) |
| `imagery.ts` | Genre-native metaphor banks (roots / urban / club / afro / eastasia / latin / southasia / quiet / europe) |
| `lyricStages.ts` | Composition engine: renders each stage's lines, budgets lines per section |
| `lyrics.ts` | Orchestration: hook, contradiction, metaphor, scale subject, conclusion |

Behaviour worth knowing:

- The **conclusion is never a resolution**: either the closing chorus qualifies the
  hook ("You and I keep the light on, or maybe we don't") or the hook repeats and the
  outro carries an open line ("We never did decide").
- Chorus repeats are byte-identical apart from that closing reframe, so the hook is
  actually a hook.
- Section headers stay plain (`[Verse 1]`, `[Chorus]`) because that is the format
  ACE-Step parses. The arc is stored on the concept (`params.lyricArc`), shown in the
  Trends view's augmentation panel (stage chips, metaphor, contradiction, conclusion,
  section-to-stage map) and written into each run manifest.
- Grammar is enforced by typed slots - places are split by preposition and hooks use
  plural subjects - so a phrase cannot land where it does not fit.
- Per-concept RNG seeds are now hashed with market+index: mulberry32 streams from
  nearby seeds correlated, which had made sibling concepts share hooks and imagery.

Preview without touching the pipeline: `npx tsx scripts/lyric-preview.ts 42`.

**Verified:** the NG/Afrobeats concept "Golden Motion" (metaphor "a door left open",
hook reframed "call it off / show up anyway", scale "the ones still driving home")
rendered through the pipeline to a valid 30.0 s MP3 at the designed 110 BPM / G major,
with the full arc recorded in the run manifest.

**Limitation:** the scaffold is a brief for the LM rewrite, not finished lyrics. With
`THINKING=true` the model may smooth or replace lines, and occasional word-level echoes
across sections are expected.
---

# Core.fm workstreams — language, forecasting, and what is still outstanding

Session notes for the Core.fm transition. Read alongside `signal-aggregator/README.md`,
which holds the reference documentation; this file records *why* each change was made,
what was verified, and what is deliberately unfinished.

## 1. Language-correct lyrics (the visible defect) — DONE for en/fr/de

**Root cause, traced in the engine:** `format_sample()` in `llm_inference.py` is a
**constrained metadata formatter** — it takes caption + lyrics + `user_metadata` (bpm,
duration, keyscale, timesignature, `language`) and emits an enhanced caption and
metadata. It is *not* a translator. `use_cot_language` only **detects** the language of
supplied lyrics and overrides `vocal_language`. So there was never an engine-side fix:
`vocal_language=ja` with English lyrics meant the model sang English phonetics tagged as
Japanese, and nothing in the pipeline could tell.

**Fix:** a lyric **language pack** owns both its banks and its grammar
(`src/design/lyrics/`). There are no shared templates — grammar is not abstractable
across these languages. `concept.vocalLanguage` is now the language the lyrics are
*actually written in*, and a language without a pack falls back to English and
**reports** it (`requestedLanguage`, `lyricLanguageFallback`, the rationale, the CLI).

| Pack | Status |
|---|---|
| `en` | complete (banks unchanged, in `lyricBanks.ts`) |
| `fr` | complete — "on" as collective subject; computed elision; adverbial self-descriptions; pre-agreed scale clauses |
| `de` | complete — nominative-only interpolation; subordinate clauses for verb-final; verb-second inversion; no separable verbs |
| `ja ko zh hi pt es it nl ru ar` | **pending** — honest English fallback |

**Singability gate** (`lyrics/validate.ts`) scores every lyric and stores
`params.lyricValidation`. It immediately earned its keep by finding four real defects: an
18-syllable English contradiction line; a 15-syllable scale line in *both* French and
German; a `scriptConsistency` above 1 because `[\u0041-\u024F]` treats `[` and `]` as
Latin letters (the `[Chorus]` brackets were being counted as letters); and a bookend
false positive on the closing chorus. Acting on it took French meter fit 0.73 → 0.91 and
German 0.78 → 0.96.

**Grammar bugs found and fixed while verifying by hand:** French `Je ai froid` →
`j'ai froid` (computed elision, since vowel-initial bank entries like `amortis`/`avance`
also produced `Je amortis`); German `und trotzdem komme trotzdem` (after a fronted adverb
German needs the subject, and the phrase already carried the verb); and my own French
hook bank initially had "on" inside the verb phrases, which would have rendered
"On on garde…".

**Verified:** `scripts/lyric-preview.ts` over 10 market/genre/language cases; a real
`design --markets fr,de,jp` run stored `vocal_language=fr|de|en` with
`requested=ja, written=en, fallback=true` for Japan — the original mislabelling is gone.
A targeted scan found zero bad elisions.

## 2. Trends pipeline — history + forecasting — DONE, history still accruing

**The blocker found first:** the database held only 32 snapshots (3–5 per market) all
inside ~2h20m. Forecasting is a derivative and needs at least two passes on two
*different days*, so the scheduler had to come first.

- `signals.track_key` (normalized `artist::title`, Unicode-aware) added and backfilled
  (2250 rows) rather than creating a duplicate history table — the per-track rank series
  is derived by joining `signals` to `signal_snapshots`, whose `captured_at` is the
  authoritative time for a whole pass. `analysis/series.ts` builds the series, and
  `metrics.ts` now shares that same track identity so momentum and the series cannot
  disagree about whether a track is persistent or brand new.
- `forecast/forecast.ts` — damped linear extrapolation of rank velocity and genre-share
  drift, each reported with its own sample depth and a plain-language caveat.
- The scheduler is **running now**: one completed pass, 590 tracks, no source errors. Off
  by default (`SCHEDULE_ENABLED=false`) so a CLI run never starts a timer unasked.

**Two bugs the first forecast run exposed:** genre shares projected undamped to absurd
values (US `country` 38% → **97%** in a week; now damped to 47% at confidence 0.05), and
a tempo-confidence formula that mixed BPM into the confidence term, making the result
depend on unit scale rather than on evidence.

**Honest status:** every market currently reports `depth: insufficient` with an empty
rising board, because all passes sit inside one day (the velocity guard deliberately
zeroes intraday-only movement). That is correct behaviour, not a failure — it becomes
useful after roughly a week of scheduled collection.

## 3. Still outstanding (planned, not started)

- **Rebrand to Core.fm.** Inventory done: 57 × "ACE-Step UI", 21 × "ace-step-ui",
  57 × "Suno" across 22 files, pink/purple accents in 18 components plus the Tailwind
  theme in `index.html`, `metadata.json`, both `package.json`s and the launcher scripts.
  The "Suno" hits are mostly marketing copy and need **rewording, not renaming**. Engine
  identifiers (`ACESTEP_PATH`, `ACE-Step-1.5/`) stay as the engine boundary, and upstream
  MIT attribution must stay (licence requirement).
- **Distribution.** Needs **no new vendor**: master and artwork validation, metadata
  sheet, ISRC/UPC (only when a registrant code + GS1 prefix is supplied, otherwise
  aggregator-assigned), a minimal DDEX ERN, per-aggregator profiles, release tracking, and
  non-negotiable compliance gates (AI disclosure, no impersonation, quality threshold,
  human review before submission). No DSP offers direct API upload; the real APIs are B2B
  label platforms, and Yandex/Zvuk/VK/QQ are artist portals.
- **Additional models.** A registry with **licence as a first-class field**
  (`distributable: true/false`: ACE-Step 1.5 is MIT ✓, MusicGen is CC-BY-NC ✗) so a
  non-commercial model can never feed a releasable master; engine adapters behind one
  interface; a 12 GB VRAM policy (exclusive swaps, serialised GPU queue); and auxiliaries
  that raise quality without more GPU pressure (CLAP/MERT embeddings for real-audio market
  fit, a local LLM for localisation review).
- **UI exposure of the forecast.** The API is live (`GET /api/forecast`, `/api/schedule`)
  and `/api/markets/:cc` embeds a forecast, but `TrendsView.tsx` does not render it yet.
- **More language packs** — `pt` next (Brazil is an active market), then `ja`, `es`, `hi`.

## 4. Verified end state of this session

- `npx tsc --noEmit` clean in `signal-aggregator`.
- Scheduler live on :3002 with a completed pass (590 tracks, 0 errors); `/api/forecast`
  and `/api/schedule` responding.
- `design --markets fr,de,jp` produced language-correct French and German lyrics and an
  explicitly reported English fallback for Japanese, with singability recorded per concept.
- Singability scores 0.742–0.799 across the preview set, with only legitimate
  above/below-band line warnings remaining.

## 5. Repository layout and the Core.fm rebrand

### Where the code lives
`SamurAI-Official/Core.fm` (a fork of `fspecii/ace-step-ui`) is now the product repo:

| Branch | Contents | Tip |
|---|---|---|
| `main` | the app **plus** `signal-aggregator/` vendored as a subtree | `5dc02c3` |
| `signal-aggregator` | the same service as a standalone lineage | `f27b9ca` |

Locally, `ace-step-ui` keeps `origin` = the fork and **`upstream` = `fspecii/ace-step-ui`**
so upstream fixes remain mergeable. The aggregator was vendored with `git subtree`
(not a squashed copy) so **both histories survive** and it stays syncable either way:

```bash
# pull aggregator work into the monorepo
git subtree pull --prefix=signal-aggregator aggregator main
```

Nothing sensitive was ever tracked: `.env`, `data/` (SQLite plus rendered audio),
`node_modules/` and logs are all excluded, and this was verified with
`git check-ignore -v` rather than assumed. A scan of the pushed tree returns clean.

### What "rebrand" changed, and what it deliberately did not
Changed: the application's own identity — product name, page titles and meta tags,
`metadata.json`, package names, share/settings/SEO strings, i18n values in all four
languages, server banners, the video download filename, and the colour namespace
(`suno` → `corefm`, including the Tailwind config key and CSS custom properties).

Not changed, on purpose:
- **Engine references.** Only the exact token `ACE-Step UI` was replaced, never
  `ACE-Step` alone — **126 engine references survive**. The app genuinely generates
  with ACE-Step 1.5 (MIT), and stripping that credit would be both dishonest and a
  licence problem. Upstream attribution and the engine repo link stay.
- **No invented identity.** With no domain owned, no URLs, support addresses or social
  handles were fabricated. The README's "Suno alternative/killer" positioning and its
  comparison-table header were removed and replaced with a factual description.
- **Launcher filenames.** `start-all.bat` / `start-all.sh` / `stop-all.sh` are generic
  names (no brand in them), so renaming them would only have broken existing shortcuts
  and documented commands for no gain. Their *contents* were rebranded.

### Bugs found while doing this
- **`start-all.sh` carried the same engine bug the `.bat` had.** It launched
  `uv run acestep-api` (the REST-only server, which cannot serve `/generation_wrapper`
  that the UI actually uses) and wrote logs to a hardcoded `../ace-step-ui/logs/`. Both
  fixed, and it now starts/stops the Trends service like the `.bat` does.
- **Service numbering** said `[1/3]..[3/3]` while four services are started; corrected
  to `[1/4]..[4/4]`.
- **Vendoring the aggregator broke the UI typecheck.** The UI `tsconfig.json` has no
  `include`, so it swept up `signal-aggregator/src/**` and failed on imports
  (`express`, `better-sqlite3`) that live only in the aggregator's own `node_modules`.
  Fixed by excluding it; each project is typechecked from its own directory.
- **Vite would have watched the aggregator's runtime data.** Its SQLite database and
  rendered audio change constantly, so HMR would churn and the page could reload mid
  render. `signal-aggregator/**` is now ignored by the dev server. *This needs a Vite
  restart to take effect (the watcher config is read at startup).*
- **A regression I introduced and then caught:** making the launchers prefer the
  vendored aggregator copy meant a vendored-but-`npm install`-less copy would shadow
  the working sibling clone and silently skip the Trends service. Both launchers now
  select whichever copy actually has `node_modules`.

### Still outstanding
- **Accent colour.** The palette namespace is renamed but the hue is unchanged, and the
  UI still uses Tailwind's built-in pink/purple for accents (**216 usages across 19
  files**). The Tailwind config is neutral greys, so those accents are the last visual
  leftover. Choosing an accent is a design decision — set it in the `corefm` palette in
  `index.html` plus the `--corefm-*` variables, then sweep the accent classes.
- **`theme-color`** is now the app's own background rather than Suno's pink; point it
  at the accent once one exists.
- **`ja`/`pt`/`hi` lyric packs**, distribution packaging, and the model registry
  (sections 3 above) remain untouched.

## 6. Core.fm brand mark (logo)

The top-left logo and the login modal now share one component, `components/BrandMark.tsx`,
so the two can never drift apart. It **prefers the raster artwork you supplied** and only
falls back to an inline SVG:

- **To activate the real logo:** save the image as
  `ace-step-ui\public\brand\corefm-logo.png`. `BrandMark` requests that path on every
  render; if it decodes, it is used. No code change needed.
- Until then, the fallback is an **inline-SVG approximation** (bladed ring + samurai bust):
  monochrome `currentColor`, so it themes. It is honest shorthand, not a trace of your
  artwork — two attempts at a faithful samurai silhouette still read as a helmeted blob,
  which is exactly why the raster is preferred.
- In dark mode the raster is inverted (`dark:invert`) because the art is black-on-white;
  on a dark sidebar it would otherwise be a black shape on a white square.
- `/brand/corefm-logo.png` deliberately 404s today. Note that under `vite dev` an unknown
  path returns `index.html` with HTTP 200 (SPA fallback) rather than 404 — the `<img>`
  still fails to decode, so `onError` fires and the fallback renders either way.

**Favicon:** `index.html` referenced `/favicon.svg` all along but **no `public/` directory
existed**, so that request had always 404'd. It now points at the single standalone artwork
`public/brand/corefm-logo.svg` (self-coloured, flips via `prefers-color-scheme` since a
favicon has no `currentColor` to inherit). Keep that file in sync with `BrandMark`'s paths
if the mark changes; `/favicon.svg` is no longer referenced anywhere.

**Wordmark casing:** the sidebar reads **Core.FM** as requested, while the rest of the app
uses **Core.fm**. That inconsistency is deliberate-for-now — say the word and it is a
one-line change either way.

## 7. Language acceptance test (es / it / pt) — design verified, render blocked

The Phase-2 acceptance gate was "one real ~20 s render per new language". **Half of it passed;
the render half did not**, and the failure was the engine's, not the language work's.

**Design half — verified for all three:**

| market | concept | language fields | singability | script |
|---|---|---|---|---|
| `es` | Neon Fever (latin, 100 BPM, G major) | `vocalLanguage`/`requested`/`written` all `es` | 0.767 | 1 |
| `it` | Hollow Motion (hip_hop_rap, 99 BPM, G minor, 6/8) | all `it` | 0.673 | 1 |
| `br` | Electric Mornings (soul_funk, 120 BPM, G major) | all `pt` | 0.704 | 1 |

In every case `languageFallback` is **absent** (the key only exists when a fallback actually
happened), so there is **no silent English substitution** — the original `vocal_language=ja`
-with-English-lyrics bug is gone. Morphology checks out in the generated hooks:
"Los dos dejamos la puerta abierta", "Noi due lo diciamo per primi",
"Aqui, a gente pega o caminho longo" (the `a gente` subject agreeing with the 3sg hook verb).
Reaching this needed new signal collection first — `es` and `it` had no data at all, so
`collect --markets es,it` was run before they could be briefed (50 tracks each, 0 errors).

**Render half — not met.** The `es` render was submitted, then the engine died mid-job and
the run was marked `failed`; `it` and `br` are still `designed`.

### Engine instability — what was actually wrong

1. **Do NOT disable CPU offload on this 12 GB card.** I tried `--offload_to_cpu false` and it
   made things worse: the GPU pinned at 100% with **11736 / 12282 MiB** and the server never
   launched after ~6 minutes. Reverted to the launcher's defaults. The engine's 20 GB
   auto-offload threshold is conservative but it is the correct call here.
2. **Auto-offload causes heavy thrash**, which is why renders are slow: per step the engine
   reloads the model to CUDA (~4 s) and offloads it straight back, with `model.to()` falling
   back to per-parameter moves for `AffineQuantizedTensor`. 20 s of audio took **over 5 minutes**.
3. **The GPU is contended by unrelated applications.** `nvidia-smi` shows **LM Studio (3
   processes)**, PrusaSlicer, RepetierHost, Edge WebView, the NVIDIA overlay and explorer all
   holding GPU contexts. Several GB are gone before the engine starts, so it never gets a
   clean 12 GB — this is the most likely reason it stalls and dies mid-render.
   **Close LM Studio (and ideally the slicers) before starting the engine.**
4. `bitsandbytes` is **not installed**, so training falls back to standard AdamW (higher VRAM).

### To finish the gate
```
cd signal-aggregator
npx tsx src/index.ts run --market es --limit 1
npx tsx src/index.ts run --market it --limit 1
npx tsx src/index.ts run --market br --limit 1
```
Force a short render first with `PATCH /api/concepts/:id` and `{"duration":20}` — that part was
confirmed working (`duration` went from 172 s to 20 s). If the engine dies again, restart it
with the `start-all.bat` command and then run `npx tsx scripts/reconcile-runs.ts`.

Still outstanding from earlier sections: the `ru` pack, then `ja`/`ko`/`zh`.

---

## 8. RESOLVED (2026-09-20): the engine crash and the "stuck at queued" renders

Two **independent** faults were breaking every render. Both are now fixed.

### 8.1 The crash: third-party flash-attn — fault `c10.dll +0x85bb4`

Windows Error Reporting captured six engine crashes in one day:

| local time | config | faulting module | offset |
|---|---|---|---|
| 14:43:48 | int8 + compile (defaults) | c10.dll | 0x85bb4 |
| 19:10:24 | int8 + compile | c10.dll | 0x85bb4 |
| 19:27:35 | int8 + compile | c10.dll | 0x85bb4 |
| 22:34:12 | int8, TORCH_COMPILE_DISABLE=1 | torch_cpu.dll | 0x6013f94 |
| 22:45:27 | quantization OFF | c10.dll | 0x85bb4 |
| 23:49:45 | defaults, **GPU free** | c10.dll | 0x85bb4 |

**Five of six hit the identical instruction**, including with quantization off and
with an empty GPU. That ruled out quantization, `torch.compile`, and GPU
contention. The differentiator is the attention backend: every crash run logged
`Attempting to load model with attention implementation: flash_attention_2`.
The installed `flash_attn` is a **third-party Windows wheel**
(`sdbds/flash-attention-for-windows`), not an official build.

**Fix:** always launch the engine with `--use_flash_attention false` (sdpa).
Use `ACE-Step-1.5\start-corefm-engine.bat`, which sets this.

After the flag the init ran straight through the point that previously died:
`DiT quantized` → `5Hz LM tokenizer loaded` → `Constrained processor initialized`
→ `5Hz LM initialized` → `Running on local URL: http://127.0.0.1:8001`.

WER dumps for these crashes are in `%LOCALAPPDATA%\CrashDumps`
(`python.exe.<pid>.dmp`). Note they are ~600 MB **each** and C: had only 2 GB free —
clear them out. Analysis helpers live in `_tools\` (see 8.4).

### 8.2 The stall: a latched queue flag in the UI backend

Renders were returning `jobId` and then reporting `queued` **forever** while the
engine sat idle. Cause, in `ace-step-ui/server/src/services/acestep.ts`:

```js
let isProcessingQueue = false;
async function processQueue() {
  if (isProcessingQueue) return;   // one-way latch, never reset
  isProcessingQueue = true;
  while (jobQueue.length > 0) { await processGeneration(...) }
}
```

`generateMusicViaAPI` fires `processQueue()` without awaiting and keeps job state
**in memory**. When the engine died mid-render (19:10) the in-flight
`await client.predict('/generation_wrapper')` never settled, so
`isProcessingQueue` stayed `true` and **every** later job was queued forever.

**Fix:** restart the UI backend after any engine crash:
```
cd ace-step-ui\server
npm run dev
```
`npx tsx scripts/reconcile-runs.ts` alone does NOT clear this — it fixes the
aggregator's DB rows, not the backend's in-memory latch.

### 8.3 Corrections to section 7

- **The GPU-contention explanation was wrong.** The engine crashes with a
  completely free GPU (869 MiB used, 0% util). A secondary GPU workload makes
  things slow, but it is not the cause. Do not treat closing LM Studio as the fix.
- **The CLI flag is `--markets`, not `--market`.** Section 7's command was wrong:
  `npx tsx src/index.ts run --markets es --limit 1`
- `run --limit N` picks concepts by score and may render a **different market**
  than requested (an `es` request rendered `ng`). To pin markets use:
  `npx tsx src/index.ts cycle --markets es,it,br --per-market 1 --generate 1`

### 8.4 Environment changes made

- **pip was broken** in `python_embeded` (`pip.exe` present but `import pip`
  failed). Bootstrapped with `get-pip.py`; now `pip 26.2.1`.
- **bitsandbytes 0.50.2 installed** (has a `win_amd64` wheel; torch untouched at
  `2.7.1+cu128`). Removes the standard-AdamW fallback that costs VRAM in training.
- Package snapshot: `_logs\env-snapshot\pip-freeze-BEFORE-bnb.txt` (123 packages).
- `torchao` 0.15.0 vs torch 2.7.1 mismatch is real but **harmless here**:
  torchao has no Windows wheels at any version, so nothing loads its compiled
  kernels and the "Skipping import of cpp extensions" warning is just noise.
  Do NOT try to "align" it — that was a dead end.
- Diagnostics kept: `_tools\analyze-dump.py` (WER dump fault/module resolution) and
  `_tools\walk-threads.py` (rank threads by native torch frames).
- Known non-fatal noise in the backend log: `'ffprobe' is not recognized` — audio
  duration probing fails, renders are unaffected.

### 8.5 Verified working

`ng` render completed end-to-end after both fixes: backend logged
`Completed via Gradio with 1 audio files`, engine wrote
`gradio_outputs\batch_1789888281\0351bcb5-...mp3` (48 kHz), and the run scored
composite 0.75.

---

# 9. Subjects, Korean/Chinese lyrics, and the trend page (2026-09-20)

Three review findings, in order: lyric generation must not be subject- or
topic-constrained; the trend logic must actually include Korean and Chinese; the Trends
page must be correct in dark mode.

## 9.1 Lyric generation is no longer subject-constrained — DONE

**The defect.** `writeLyrics` accepted `themes` and *never read it*, and used `terms`
only for one English ad-lib (gated on `pack.code === 'en'` and `/^[a-z]+$/`). Every other
word came from banks that tell a single story (midnight, staying or leaving,
ambivalence), so every market, genre and language produced the same subject with
different wording. The generator could not be *about* anything else — which is what
"subject-constrained" means here, and no amount of grammar would have fixed it.

**The fix** — `src/design/lyrics/subjects.ts` plus a subject slot in every pack:

- six subjects (`leaving-and-staying`, `city-and-work`, `family-and-distance`,
  `celebration-and-hustle`, `memory-and-loss`, `starting-over`), each with the chart
  words and theme phrases that point at it and the imagery families it prefers;
- `chooseSubject()` matches those keywords against the market's own chart words and
  flavour themes first, and falls back to a seeded, rotating draw — so `themes` is live
  input rather than decoration;
- `designConcepts` reads the market's previous subjects back out of the store
  (`usedSubjects()`), so three designs in one batch are three different subjects and the
  next run does not repeat the last one;
- each pack declares `subjectCoverage` and owns its own subject material (`adlib`,
  `selves`, and per-stage banks). Only covered subjects are ever chosen *for that pack*,
  so a subject it cannot write is impossible to label a concept with; uncovered slots
  fall back to the general bank, so a pack can be deepened one subject at a time;
- the ad-lib gate is now **script-aware** instead of English-only: a Hangul chart word is
  usable in Korean lyrics and a Latin one is still refused there;
- imagery follows the subject 60% of the time and the genre the rest, so a screen door
  still reads country;
- provenance is recorded (`params.lyricSubject`, `…Label`, `…Source`, `…Matched`,
  `…Realised`), printed by the CLI (`about:`) and `scripts/inspect-concepts.ts`, and shown
  in the Trends augmentation panel next to the arc chips.

Coverage today: `en`, `ko` and `zh` carry all six subjects; `fr`, `de`, `es`, `it`, `pt`
and `ru` carry three each (fragment-level: ad-lib, self-description, closing line), with
the same structure ready for more.

## 9.2 Korean and Chinese — DONE (packs + markets)

`src/design/lyrics/ko.ts` (Hangul) and `zh.ts` (Han) are complete packs, registered and
removed from `PENDING`. Neither language inflects, so the hazards are different from the
European packs and that is where the care went:

- **Korean**: particles (은/는, 이/가, 을/를) depend on whether the preceding syllable has
  a final consonant, so every one is baked into its bank entry rather than appended;
  plain 한다/해체 style throughout, because mixing honorific levels is the flaw a listener
  notices first; bare time nouns, since a wrong copula or politeness level is worse than
  none.
- **Chinese**: measure words and word order replace inflection as the hazard, so banks
  are whole phrases and no template adds a particle that depends on the preceding
  syllable; one syllable per character; rhyme is approximate on purpose, because Mandarin
  rhyme is a rime-plus-tone system that orthography cannot express.
- **Markets**: `MARKETS` now includes `kr,cn` (`.env`, `.env.example`, README row). The
  `.env` list had been overriding `DEFAULT_MARKETS`, so Korea and China were absent from
  the Trends page entirely; `npm run report` now lists both rows.
- **Language options in the UI** now come from the aggregator (`GET /api/languages`,
  built from the pack registry) instead of a hard-coded list that had already drifted —
  it was missing `ru` while a Russian pack existed. Codes with no pack are still offered,
  labelled "falls back to English".

**Verified** (`npm run test:packs -- ru ko zh`): no fallback, correct script, no clichés,
score ≥ 0.6 — ko avg 0.770 / meterFit 0.751, zh 0.804 / 0.978, ru 0.779 / 0.941.
`scripts/lyric-preview.ts` now reports 2 fallbacks out of 13 cases (`ja`, `hi`) instead of
five.

**Not verified: naturalness.** Both packs are machine-written and declare
`reviewStatus: 'unreviewed'`; a native-speaker pass is the only thing that can settle
idiom, and no test stands in for it.

## 9.3 Trends page dark mode — DONE

- The augmentation editor's Key / Meter / Vocal-language **selects and inputs** now use a
  solid surface (`bg-white dark:bg-zinc-900`, `dark:border-zinc-700`) instead of a
  5%-white wash, matching the convention already used in `SettingsModal`.
- `index.html` declares `color-scheme: light` and `.dark { color-scheme: dark }` (and the
  theme effect sets `documentElement.style.colorScheme` as well), so **native widgets** —
  select popups, number spinners, checkboxes, `<audio>` controls — follow the theme.
  Without it a dark page kept light popups, and the option text (white) vanished into them.
- Dark-only accent text was paired so the page reads in **both** themes:
  `text-emerald-700 dark:text-emerald-300`, `text-red-700 dark:text-red-300`,
  `text-purple-700 dark:text-purple-300`, `text-amber-800 dark:text-amber-200`,
  `text-amber-700 dark:text-amber-400`, and the 35 bare `text-zinc-500` labels gained
  `dark:text-zinc-400`.
- The concept editor shows the subject ("About: … (chart-topic: family)") beside the arc
  chips.

**Not verified on screen:** this was checked in code and by typecheck, not visually.
Running `npm run dev` and toggling the theme on the Trends tab is the confirmation step.

## 9.4 Committed and pushed

Both lineages in `SamurAI-Official/Core.fm` now carry this work:

| Ref | Commit | Contents |
|---|---|---|
| `signal-aggregator` (standalone lineage) | `38fb9a1` | the aggregator-side work: subjects engine, `ko`/`zh`/`ru` packs, `kr,cn` markets, `/api/languages`, the two gates, docs |
| `main` (app + vendored subtree) | `00d2add` | the UI-side work: Trends subject line, pack-driven language options, dark-mode fixes, the local `acestep.ts` Gradio-failure patch |
| `main` | `4278366` | `git subtree pull` merge that updates `signal-aggregator/` in the repo, 23 files |

The vendored copy was verified to be **byte-identical** after the merge rather than
assumed: `git rev-parse HEAD:src` in the standalone repo and
`git rev-parse HEAD:signal-aggregator/src` in the app repo return the same tree hash
(`357cd7b`), and `scripts/` matches too.

```bash
# kept in sync this way from now on
cd signal-aggregator && git add -A && git commit -m "..." && git push origin main:signal-aggregator
cd ../ace-step-ui && git add -A && git commit -m "..." \
  && git subtree pull --prefix=signal-aggregator aggregator main -m "Merge aggregator"
git push origin main
```

Note the local branch name differs from the branch it publishes to (`main` ->
`signal-aggregator`), so a bare `git push` in the aggregator repo is refused by
`push.default=simple`; push it explicitly as above.

## 9.5 Still to do

- **Restart the Trends service** (`start-aggregator.bat`) so the new packs and markets
  are live; run `npm run collect -- --markets kr,cn` to give Korea and China chart data
  (both currently report 0 signals, so they have no brief to design from yet).
- **`ja` and `hi`** are the next packs (the acceptance gate takes a list:
  `npm run test:packs -- ja hi`).
- **Korean and Chinese naturalness is unreviewed.** Both packs are machine-written and
  say so (`reviewStatus: 'unreviewed'`); a native-speaker pass is the only thing that
  can settle idiom.
- **Korean and Chinese market fit / novelty** remain structurally weak for the same
  reason Japanese did: keyword matching reads English, so those charts rotate subjects
  instead of matching topics.
- **Only six subjects exist.** The catalogue and the per-pack tables are data, so adding
  one is an entry in `SUBJECTS` plus per-pack material — but every line added still has
  to be checked against the template it lands in, which is the work, not the wiring.

### 9.6 Verification run in this session

| Gate | Result |
|---|---|
| `npx tsc --noEmit` in `signal-aggregator` | clean |
| `npx tsc --noEmit` in `ace-step-ui` | clean |
| `npm run test:lyrics` | pass (40 fixtures) |
| `npm run test:packs -- ru ko zh` | `PASS: all pack checks cleared` |
| `npm run test:subjects` | `PASS: subject spread cleared` — 9 packs; 6 subjects each for en/ko/zh, 3 for the rest; forced subjects change the lyrics; ko ad-lib `사랑`, zh ad-lib `我不难过`, Latin rejected for ko; chart `family` → family-and-distance, `party` → celebration-and-hustle |
| `npm run report` | `kr South Korea` and `cn China` rows present (0 signals until collected) |
| subtree sync | vendored `src` tree hash equals standalone `src` tree hash |

## 9.7 Two problems the first pass missed (2026-09-20, follow-up)

The first pass shipped the packs, the subject engine and the dark-mode class sweep, and
still left both reported symptoms in place. Both had causes outside the files I had been
reading, and both are worth writing down.

### The Trends service was a stale process

`http://127.0.0.1:3002` was being served by a `tsx src/index.ts serve --schedule`
process started **before** any of this work. It reported:

```
/api/health     markets: us,gb,fr,de,br,jp,in,ng      (no kr, no cn)
/api/languages  404 Not Found                          (endpoint did not exist yet)
```

The Trends page's market chips and cards come from `/api/overview`, which iterates
`config.markets` — so Korea and China were absent no matter what the code said, and the
language dropdown was falling back to the client's built-in list. Committing and pushing
cannot change a running service.

Fixed by restarting it (same command and flag it had been started with):

```bash
cd signal-aggregator && npm run serve -- --schedule
```

Verified against the live service after restart:

```
/api/health     markets: us,gb,fr,de,br,jp,kr,cn,in,ng
/api/languages  en, fr, de, es, it, pt, ru, ko=Korean, zh=Mandarin Chinese (+23 pending)
/api/overview   kr South Korea  languages=ko        cn China  languages=zh
```

A collection pass starts on launch (`--schedule`), which is what populates kr/cn charts;
until it finishes those two markets legitimately report 0 signals and have no brief, so
they cannot be designed for yet.

### The white background was an invalid Tailwind class

`App.tsx` set the app root (and the song-list column) to
`bg-white dark:bg-corefm-DEFAULT`. Tailwind emits `bg-corefm` for a colour keyed
`DEFAULT`; **`bg-corefm-DEFAULT` is not a utility it generates**, so the class was
silently dropped and `bg-white` was the only background that ever applied. The Trends
page has no background of its own, so it inherited that white while its cards were
correctly `dark:bg-corefm-card` — exactly the reported "dark mode still has a white
background".

Proved rather than guessed, by compiling the app's own config with the Tailwind CLI:

```
.bg-corefm-card            { background-color: rgb(24 24 27 / …) }   ← generated
.dark\:bg-corefm:is(.dark *){ background-color: rgb(9 9 11 / …) }    ← generated
dark:bg-corefm-DEFAULT                                              ← nothing
```

Both usages now read `dark:bg-corefm`. The same class of defect was then swept for: all
110 `dark:*` / `*corefm*` classes used anywhere in the app were compiled against the
app's config, and every one generates a rule except `dark:scrollbar-thumb-zinc-700`,
which is a `tailwind-scrollbar` plugin utility that the CDN does not load and is
therefore inert (the real scrollbar styling is the `::-webkit-scrollbar` block in
`index.html`).

### The lesson to keep

The first pass checked code and typecheck and called dark mode done; it had never looked
at the page background, and it had never asked whether the process serving the data was
the code that had been changed. Both were findable in one command each:
`Invoke-RestMethod /api/health` and a background-class sweep.

---

# 10. Writing styles: twenty engines, added not swapped (2026-09-20)

**The ask.** The lyric generator told every market, genre and subject the same way, and the
review brief specified twenty distinct songwriting engines (Hook → Variation → Payoff,
Question → Answer → Bigger Question, escalating stakes, a countdown, a circular return and so
on) to be added as *separate* writing agents for the trend pipeline, not as replacements.

**The approach agreed first:** prove the mechanism on two styles, read the real output, then
decide the remaining eighteen from what the songs actually look like.

## 10.1 What landed

| Piece | Where | What it does |
|---|---|---|
| `WritingAgent` + registry | `src/design/agents/` | A style declares its engine chain, the primitives it needs, whether repetition is a fault or the device, a genre/energy affinity, and two functions: `plan()` (sections, roles, line budgets, variants) and `write()` (arrangement → lines through the pack) |
| Pack primitives | `src/design/lyrics/primitives.ts` | `question`, `answer`, `claim`, `reversal`, `implication`, `universal`, `ladder`, `fragment`. Unlike `render` banks (which complete a template the pack owns), a primitive is placed by the agent, so an entry must read correctly **standing alone**. Coverage is derived from the table |
| Style selection | `agents/registry.ts`, `designer.ts` | Coverage-filtered (only styles the pack can write), rotation-aware via `store.usedAgents()`, weighted by `fits()`, overridable per concept. Source recorded as `rotation` / `affinity` / `seeded` |
| Repetition policy | `lyrics/validate.ts` | `repetitionPolicy: 'fault' \| 'device'`. The count is always measured (`repeatedLines`); only the fault interpretation costs score, and the gate asserts a device style really repeated something |
| Provenance | `src/design/provenance.ts` | One helper used by **both** the designer and the reroll endpoint, writing `lyricAgent`, `…Name`, `…Engine`, `…Blurb`, `…Source`, `…Realised`, `…Summary`, `…Report`, `lyricStructure`, `lyricRepetitionPolicy` plus the language/subject/validation fields |
| UI + API | `GET /api/agents`, `POST /api/concepts/:id/reroll-lyrics`, Trends panel | Design-time selection alone would have made twenty styles unreachable: a style can now be tried against a market and subject with no design run and no render |
| Gate | `npm run test:agents` | Per style × per pack: the shared bars **plus** the engine's own claims, rotation safety, and structure/subject variety across seeds |

**Two styles implemented, one from each end of the difficulty range**

- `refrain-mutation` (Refrain With Semantic Mutation) - arrangement-only: the hook is sung
  word-for-word while the context changes (literal → doubt → image → alone). Exercises the new
  variant caching, `repeatOf`, and repetition-as-device.
- `question-answer` (Question → Answer → Bigger Question) - primitive-hungry: needs the new
  `question`/`answer` banks. Exercises coverage gating, cooperative degradation, and the engine
  assertions.

`arc` is now *an agent* rather than the engine itself, and stays the default: existing concepts
keep the structure they were written with, and `params.lyricArc` is still produced for them.

## 10.2 Three defects the work itself exposed

1. **The gate checked descriptors, not agents.** `listAgents()` returns descriptors whose
   `needs` are `{id, label}` objects; passing those to `coversPrimitives()` made every coverage
   check pass vacuously. The gate iterates the real `AGENTS` now.
2. **The degradation path was broken in two ways.** For a pack without the primitive banks,
   `question-answer` fell back to stage-bank lines that were neither length-ordered (so
   "questions lengthen" failed) nor de-duplicated (a reframed conclusion repeats its
   parenthesised line, so "answers repeat" failed). Both are fixed in `orderByLength()`, and the
   agent now reports `questionsAvailable`/`answersAvailable` so the gate can tell "repeated
   because the bank ran out" from "repeated when there was more to ask".
3. **`lyric-preview.ts` crashed** on `plan.arc.metaphor`: with three styles, the arc is no longer
   guaranteed. The script is style-aware now, prints the style/engine/shape for every case, and
   takes `--agent <id>`.

## 10.3 Verified

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (aggregator, UI) | clean / clean |
| `npm run test:lyrics` | pass (40 fixtures) |
| `npm run test:packs -- ru ko zh` | `PASS: all pack checks cleared` |
| `npm run test:subjects` | `PASS: subject spread cleared` |
| `npm run test:agents` | `PASS: writing styles cleared` — arc 0.779–0.799, refrain-mutation 0.770–0.850, question-answer 0.800–0.831 across en/ko/zh, plus forced-and-degraded runs in fr; rotation never handed fr a style it cannot write; 7 structure × subject combinations in 8 designs |
| `lyric-preview.ts 42` | 13 cases, 2 fallbacks (`ja`, `hi`) — unchanged |

Engine assertions that earned their place: the refrain is byte-identical across its
restatements and sung at least three times; the repeated chorus matches exactly; questions come
from the pack's own bank, never repeat within a song, and lengthen across it; the closing
question differs from the opening one.

## 10.4 What is next, and what is honestly limited

- **Eighteen styles remain**, each needing its recipe *and* an engine assertion in the gate (the
  gate fails a style with no assertions, deliberately, so a style cannot be "added" as a label).
  Grouped by what they need: pure arrangement (`slogan-story`, `object-symbol`,
  `one-line-premise`, `circular`, `missing-character`, `groove-return`, `image-meaning`); one new
  bank (`hook-variation-payoff`, `false-resolution`, `promise-violation`); primitive-hungry
  (`specific-universal`, `confession-denial`, `character-choice`, `escalating-stakes`,
  `countdown`, `thought-actually`, `everybody-says`, `call-response`).
- **Six packs lack the primitives.** `fr`, `de`, `es`, `it`, `pt`, `ru` carry no question/answer
  banks yet, so `question-answer` is not chosen for them and degrades honestly when forced. Bank
  content is the real cost: roughly 7 primitives × ~4 lines × 6 languages.
- **`question-answer`'s escalation is structural, not semantic.** Distinct questions that lengthen
  across the song is a proxy; real rising stakes need the `ladder` primitive.
- **Two engines are half musical.** `promise-violation` and `groove-return` describe melody and
  groove; only their lyrical half is ours. The intent is carried into the style prompt as a hint
  (`agentStyleHints` → `composeStylePrompt`) and the rest belongs to ACE-Step.



## 11. All twenty writing styles, in every language

### 11.1 What was implemented

The songwriting brief listed twenty structures. Two shipped first (`refrain-mutation`,
`question-answer`); this session built the other **eighteen**, so the registry now holds
**21 styles** (the `arc` default plus all twenty).

| Tranche | Styles |
|---|---|
| Arrangement only (7) | slogan-story, object-symbol, one-line-premise, circular, missing-character, groove-return, image-meaning |
| One bank each (3) | false-resolution, promise-violation, confession-denial |
| Primitive-hungry (8) | hook-variation-payoff, specific-universal, character-choice, escalating-stakes, call-response, countdown, thought-actually, everybody-says |

`false-resolution` was classified as "needing one bank" in the plan; in the end it reads
`reversal` and asserts the destabilising detail arrives *after* the resolution it undoes.

### 11.2 The primitive layer, completed

`question`, `answer`, `claim`, `reversal`, `implication`, `universal`, `ladder`, `deadline`,
`fragment` — **all nine now exist in all nine packs**, including the six that had none
(`fr de es it pt ru`), and `deadline` is new. Coverage is derived from the tables, so a pack
cannot claim a primitive it does not have, and every style is therefore selectable in every
language — the gate reports no unrealised style anywhere.

### 11.3 Shared style helpers (`src/design/agents/shared.ts`)

`stageLines`, `optionalPrimitive`, `uniq`, `onceLine`, `oncePrimitive`, `songState`,
`shortestLine`. Two carry real lessons:

- `uniq` de-duplicates the way **the validator** counts repetition: lower-cased, parentheses
  stripped. A line and its parenthesised backing-vocal echo are the same line to the gate, so a
  style emitting `(X)` beside `X` in one section scored as a fault while looking distinct in code.
- `onceLine`/`oncePrimitive` draw per song, keyed off the `LyricContext` identity, because the
  report and the renderer must name the *same* line. Drawing twice produced manifests that named
  objects and premises the lyric never sang.










### 11.4 `boundedReframe` and the reframe trap

`hook, qualifier` exceeds the meter band in the longer-syllable languages, so reframing became a
shared helper in `types.ts` with a 12-syllable ceiling per script. The first version fell back to
the **bare hook** when the combination was too long, which made the "reframed" conclusion
word-for-word identical to the hook; the gate caught it as a repeated line in `missing-character`
(16 runs across 8 packs). The fallback is now the **qualifier alone**: still a turning of the hook
against itself, never a repeat.

### 11.5 Real defects the new styles exposed in existing packs

The most valuable output of the session, because these were invisible while only the arc existed
(it uses each bank entry once, whereas the new styles repeat and re-draw lines):

| Pack | Defect | Fix |
|---|---|---|
| en | hook bank was 3-4 syllables; styles repeating the hook 4-5x dragged whole songs under the band | hooks lengthened to 6-7 syllables |
| ko | `times + places` glued into one line → 15 blocks against a 9.6 target | one idea per line; `아직도 + object` prefix dropped; metaphors shortened |
| ko | reframe ran to 15 blocks | bounded via `boundedReframe('hangul')` |
| es | `perspective` joined place + detail → 15-21 syllables | de-concatenated |
| it | same | de-concatenated |
| pt | same | de-concatenated |
| ru | comma between time and place read as two fragments | joined |

Measured on the acceptance packs: ru 0.805 → **0.796**, ko 0.891 → **0.849**, zh 0.812 →
**0.805**. The small drops are the price of the packs now being exercised by 21 structures
instead of one; every pack still clears its bars (score ≥ 0.6, meterFit ≥ 0.5, script ≥ 0.9, no
clichés).

### 11.6 The gate asserts engines, not names

`scripts/agent-spread.ts` has one assertion block per style and **fails any registered style with
none** — a style whose engine cannot be observed in its output is a label. Examples: the refrain
must be byte-identical across its mutations; the ladder must be sung in the bank's own order; the
universal statement must not lead the song; the call/response answer must repeat verbatim and
change exactly once at the end. Engine assertions are **skipped for a degraded run** (a style
forced onto a pack lacking its primitives) and the count of skipped checks is printed rather than
hidden.

### 11.7 Verification (from the committed state)

```
npx tsc --noEmit (aggregator / ace-step-ui)   clean / clean
npm run test:lyrics                           pass (40 checks)
npm run test:packs -- ru ko zh en fr de es it pt
                                              PASS - all NINE packs, not just the three sampled:
                                              en 0.796 / fr 0.800 / de 0.808 / es 0.796 /
                                              it 0.787 / pt 0.796 / ru 0.796 / ko 0.849 / zh 0.805
                                              meterFit 0.963 - 1.000
npm run test:subjects                         PASS
npm run test:agents                           PASS  (21 styles x 9 packs x 4 seeds; nothing unrealised)
npx tsx scripts/agent-spread.ts --print       PASS  (6,425 lines: a sample song per style)
npx tsx scripts/lyric-preview.ts 42           pass (9 packs listed)
variety                                       8 seeds in one market -> 8 distinct structure x subject combinations
```

**The assertion table covers the registry exactly.** Rather than trust the gate's own green tick, I
enumerated both sides: 21 keys in `ENGINE_CHECKS`, 21 registered styles, and comparing the two sets
gives **nothing registered-but-unasserted and nothing asserted-but-unregistered**. The coverage side
was checked the same way - for every style, every one of the 9 packs holds every primitive in its
`needs`, so no style is unreachable in any language and no run is degraded. (Both checks live in a
throwaway script, now deleted; the gate asserts the same thing on every run, which is why the temp
script was not worth keeping.)

The `--print` output is the honest evidence the styles differ: same market, same seed, same
subject - `arc` builds a seven-section arc, `hook-variation-payoff` states a claim four times and
turns it with one `implication` line, and `countdown` opens on the deadline and walks obstacles in
bank order:

```
--- countdown (seed 1) ---
  summary: "Three days until the money runs out" against the clock, deciding "So I turn it up"
  [Intro]   Three days until the money runs out
  [Verse 1] One night before the train leaves / I lost the keys again
  [Chorus]  <hook> / I missed the last train home / I missed the interview
  [Verse 2] I lost the job in March / It's closing time on a dead-end road
  [Bridge]  Ten dollars until the weekend / I cannot make the rent
  [Outro]   So I turn it up
```

### 11.8 Pushed

```
aggregator (standalone)   863e576  all styles, all languages
                          0036221  README: name the engine assertion each style is held to
                          -> origin/signal-aggregator

Core.fm main              ad77223  subtree sync of 863e576
                          3b3be50  subtree sync of 0036221
                          -> origin/main

vendored src tree hash    aff40d8  ==  standalone src tree hash aff40d8
```

### 11.9 Restarting the service on 3002, properly

The aggregator picks up new styles **only on restart** — the registry is read at boot, so a running
process lists the old set (this is the same stale-process trap that hid Korean/Chinese trends
earlier, in §9.6).

The first attempt failed in a way worth recording: I launched it as a hidden child of my own shell
(`Start-Process cmd.exe -WindowStyle Hidden ...`). It came up, served requests, and then **died
silently when that shell session ended** — `/api/agents` and `/api/health` both went to
"Unable to connect". A process started that way is tied to the console that spawned it.

Start it detached instead, so it survives the shell:

```powershell
$log = "$env:TEMP\sn-serve.log"
$inner = 'cmd /c cd /d "G:\Program Prototype\SafetyNet\signal-aggregator" && npm run serve > "' + $log + '" 2>&1'
([wmiclass]'Win32_Process').Create($inner)   # parent is WmiPrvSE, not your shell
```

`start-aggregator.bat` does the same thing the documented way (it opens its own window). Note it
runs **plain `npm run serve`**, not `--schedule`; add `--schedule` if you want the collector loop
running alongside the dashboard.

Verified after this restart: `listening on http://localhost:3002`, `/api/agents` → 21 styles with
all 9 packs each, `/api/health` → 10 markets, `/api/overview` → 10 markets.

### 11.10 Notes for next time

- **Never `git subtree pull --squash`** here. It breaks the lineage and conflicts on the next pull
  (`zh.ts` and `types.ts` add/add). The working form is
  `git subtree pull --prefix=signal-aggregator aggregator main`; abort a bad one with
  `git merge --abort`.
- The vendored copy is **source only** — no `node_modules` — so `npm run test:*` inside
  `ace-step-ui/signal-aggregator` fails with "tsx is not recognized". Run gates from the
  standalone repo and verify the sync with `git rev-parse 'HEAD:src'` against
  `'HEAD:signal-aggregator/src'`.
- Adding a style now **requires an engine assertion block**, or the gate fails. That is deliberate:
  it is what stops a style existing as a name only.


---

## 12. Dataset editor: the 500 on save, and what else was behind it (2026-09-20)

**Symptom.** Editing a training dataset (adding lyrics, captions, genre) and pressing save returned
**500**, so lyrics never reached the dataset file. The training pipeline therefore refused to run:
preprocessing rejects a dataset with no labeled samples, and nothing was ever labeled on disk.

### 12.1 Root cause of the reported bug: a save that could never work

`POST /api/training/save-dataset` posted to `${apiUrl}/v1/dataset/save`. That path **is** defined in
the engine (`acestep/api/train_api_dataset_service.py`), which is why it looks correct — but nothing
ever calls `register_training_dataset_routes`, so the route is never registered and the engine
answers **404 "Not Found"**. The handler turned that into a 500.

The per-sample save was fine all along: `/save-sample` maps to the Gradio endpoint
`/save_sample_edit` and worked (verified by reading the sample back: lyrics, caption, bpm, key and
language were all in engine state). Only the **persist** step failed, which is exactly why edits
looked saved in the panel and then vanished from the file.

**Fix.** `save-dataset` now calls the engine's real Gradio endpoint `/save_dataset` with
`[save_path, dataset_name]`, and reads `[status, gr.update]` out of the response. The dataset builder
is a Gradio **State** and must not be passed positionally — the same class of bug as
`isFormatCaption` in the generation wrapper.

### 12.2 Second defect: dataset settings were silently discarded

`/api/training/update-settings` was a stub returning `{ "success": true }` and calling nothing, so the
custom tag, tag position, all-instrumental flag and genre ratio never reached the engine. The saved
JSON proved it: those fields were written as `{"__type__": "update"}` (unset) instead of values.

**Fix.** The route now calls the Gradio `/update_settings` endpoint. Because the engine applies all
four values unconditionally on every call (`set_all_instrumental` and `genre_ratio` are not guarded),
a partial payload would silently overwrite the rest — so a partial set now returns **400** with an
explanation instead of quietly clobbering, and `save-dataset` applies the settings before serialising
so the metadata is written with real values.

### 12.3 Third defect: `/preprocess` threw before reaching Python

`training.ts` was the **only** file in the server using the bare `__dirname` global. The server is ESM
(`"type": "module"`), so it threw `__dirname is not defined` on every call, caught by the route's own
try/catch and reported as a generic 500. Every other file defines it via
`fileURLToPath(import.meta.url)`; `training.ts` now does the same.


### 12.4 Fourth and fifth defects in `preprocess_dataset.py`

With the path fixed, Python finally ran and exposed that the script was written against an API that
does not exist. Both were verified from the engine's own source, not guessed:

| Defect | Evidence | Fix |
|---|---|---|
| `builder.load_from_dict(...)` | `AttributeError: 'DatasetBuilder' object has no attribute 'load_from_dict'` | `builder.load_dataset(path)` — the real method in `dataset_builder_modules/serialization.py`, returns `(samples, status)` |
| emoji status printed to stdout | `UnicodeEncodeError: 'charmap' codec can't encode character '\u2705'` — the Windows console is cp1252 and the engine's statuses are full of ✅ | `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` |

### 12.5 Verified (against the running stack)

```
load  -> "📂 Loaded dataset: my_lora_dataset / 4 samples (0 labeled)"
edit  -> "✅ Updated: Money.mp3"
save  -> {"status":"✅ Dataset saved to ..._tmp-regress.json\n4 samples, tag: 'mudayn'",
          "path":"./datasets/_tmp-regress.json","settingsApplied":true}
```

The written file contained what the editor had put in: `labeled: true`, caption, genre, `bpm: 96`,
`keyscale: "G Major"`, `language: "en"`, the lyrics with their newline intact, and real metadata
(`custom_tag: "mudayn"`, `tag_position: "replace"`, `all_instrumental: false`, `genre_ratio: 0`).
`/preprocess` now loads the dataset and correctly refuses an unlabeled one with a clear message
instead of a generic 500.

### 12.6 Sixth defect: preprocessing, fixed by registering the engine's dataset routes

The standalone script could not load models at all — it imports `acestep.pipeline_ace_step`, which
**does not exist** in this engine build (`No module named 'acestep.pipeline_ace_step'`). Its fallback
message says "use the Gradio UI for preprocessing", but there is **no Gradio preprocess endpoint**:
the 147 named endpoints contain `/training_wrapper`, `/load_training_dataset`, `/save_dataset`,
`/save_sample_edit` and nothing for preprocessing.

The engine, however, already implements a complete dataset API
(`acestep/api/train_api_dataset_service.py`: scan, load, save, preprocess, auto-label, sample CRUD),
composed by `acestep/api/train_api_service.py`. **Nothing ever registered it for the Gradio app** —
`register_training_dataset_routes` had no caller, which is the same gap that made
`/v1/dataset/save` 404. `api_server.py` (the REST-only server) registers it; the Gradio pipeline does
not.

**Fix.** `setup_api_routes` / `setup_api_routes_to_app` now call a new
`_register_training_dataset_routes(app, dit_handler)`, which supplies the five callables the registrar
needs. Preprocessing therefore runs **inside the engine process**, where the models are already
resident:

- `verify_api_key` and `wrap_response` reuse the ones already in `api_routes.py`;
- `_atomic_write_json` / `_append_jsonl` are reimplemented there (trivial, same contract);
- `_temporary_llm_model` is a thin wrapper that **lazily** imports `api_server`'s implementation, so
  importing that module (which builds its own FastAPI app at module scope) is a consequence of
  needing a model swap, not of starting Gradio;
- `app.state.handler` is set alongside `app.state.dit_handler`, since the dataset service reads the
  former and `setup_api_routes` sets the latter.

A seventh latent bug surfaced immediately: the engine's own `/v1/dataset/preprocess` called
`preprocess_to_tensors(..., skip_existing=...)`, but that method has no such parameter (and no skip
logic at all) —

```
Preprocessing failed: PreprocessMixin.preprocess_to_tensors() got an unexpected keyword argument 'skip_existing'
```

— so the REST preprocess route could never have worked either. The parameter was dropped from both
call sites and the phantom `skip_existing` field removed from `PreprocessDatasetRequest`.

`training.ts`'s `/preprocess` now loads the saved JSON into the engine (`/v1/dataset/load`) and then
calls `/v1/dataset/preprocess`, instead of spawning Python. The JSON is the handoff between editor
and trainer; the spawned script is no longer on the path. It still checks the engine's response
envelope, because those endpoints return **HTTP 200 even on failure** with `{data, code, error}`.

**Verified** on a labeled dataset:

```
POST /api/training/preprocess
 -> {"status":"✅ Preprocessed 1/1 samples to ...\_tmp-tensors
              ℹ️ LLM was temporarily unloaded during preprocessing and restored afterward.",
     "outputDir":"...\_tmp-tensors","tensors":1}
```

producing `43192de0.pt` (5.2 MB) and a `manifest.json` (`num_samples: 1`), which the app then
recognised: `📂 Loaded preprocessed dataset: _tmp-labeled / 🔢 Samples: 1 preprocessed tensors`. The
engine log shows `_load_model_context` moving VAE, text encoder and DiT onto the GPU and back inside
the one process, which is the point of doing it this way on a 12 GB card.

### 12.7 Operational trap worth remembering

Gradio **State is per-session**, and `getGradioClient()` caches one client. A backend restart (or a
`tsx watch` reload during development, which happens on every file save) produces a new session, so
the engine's loaded dataset becomes unreachable: saving then returns the engine's own
`"❌ No dataset to save. Please scan a directory first."` rather than failing. Saved JSON files are
unaffected — only the unsaved in-memory edits go. **Load the dataset again after a backend restart.**

### 12.8 Files changed and committed

```
ace-step-ui/server/src/routes/training.ts            save-dataset, update-settings, preprocess, __dirname
ace-step-ui/server/scripts/preprocess_dataset.py     load_dataset, UTF-8 streams (no longer on the path)

ACE-Step-1.5/acestep/ui/gradio/api/api_routes.py             registers the dataset routes
ACE-Step-1.5/acestep/api/train_api_dataset_service.py        drops the phantom skip_existing
```

```
ace-step-ui   main                  3ee9df9  "Fix dataset save 500: lyrics were never persisted"
                                            PUSHED to Core.fm (3b3be50 -> 3ee9df9)

ACE-Step-1.5  corefm-local-patches  4ed465f  "Register the training dataset routes for the Gradio app"
             (branch sits on top of tag v0.1.0, NOT pushed - see below)
```

The two engine files are **the third local engine patch** (see "Local patches applied" above). It is
additive — routes only — and the engine is a git checkout of `github.com/ace-step/ACE-Step-1.5`, whose
remote is **upstream**, so do not push it. A `git pull` of the engine will drop these two files'
changes and the dataset routes will 404 again.

Two different repos, two different rules — worth stating plainly because they are easy to conflate:

| Repo | Whose | Push? |
|---|---|---|
| `ace-step-ui` (Core.fm) | ours — `github.com/SamurAI-Official/Core.fm` | **yes**, always |
| `ACE-Step-1.5` (engine) | ACE-Step's, we only patch it locally | **no** — push nothing to upstream |

**The engine checkout is on a detached HEAD from tag `v0.1.0`** (local `main` is 44 commits behind
upstream, so the install deliberately sits on the release tag rather than on `main`). A commit on a
detached HEAD belongs to no branch and is easy to lose on a checkout, so the patch was anchored with:

```bash
git branch corefm-local-patches HEAD     # additive; does not change the checkout
```

HEAD is still detached and the working tree is untouched, so the running install behaves exactly as
before — but the patch is now reachable from a ref. To undo the anchoring: `git branch -d
corefm-local-patches`.

### 12.9 Pipeline status after this work

```
design -> edit in the dataset panel -> save (persists lyrics, labels, settings)
       -> preprocess (in-process, writes .pt + manifest)
       -> load-tensors (app recognises the manifest)
       -> start training (/training_wrapper with tensor_dir)      <- not yet run end to end
```

Training itself was deliberately **not** kicked off: `/training_wrapper` runs for as long as the LoRA
training takes, which is a decision for you rather than a smoke test. Everything feeding it is now
verified. The one step never exercised is a full training run.


---

## 13. External LoRA adapters from Hugging Face (2026-09-20)

**Goal.** Pull community LoRA adapters down and use them with our engine, starting with
`tarn59/super_eurobeats_ACE_STEP-1.5-lora`. The five repos in scope:

| Repo | Ships | Format | Declared base |
|---|---|---|---|
| `tarn59/super_eurobeats_ACE_STEP-1.5-lora` | `adapter_model.safetensors` (176 MB), **no config** | PEFT weights | `ACE-Step/Ace-Step1.5` |
| `2600A/ace-step-v1-5-turbo-lora-dark-cybertrance-v0-71` | `epoch_620.../adapter/{config,weights}` | PEFT dir, nested | turbo |
| `kemendev/russian-pop-lora` | root `adapter_config.json` + weights | PEFT dir (declares r=64, alpha=128) | `Ace-Step1.5` |
| `David-A-Amoo/ACE-Step-1.5-Naija-Legacy-Rhythms-LoRA-v1` | weights, **no config** | PEFT weights | `acestep-v15-base` |
| `ACE-Step/ACE-Step-v1-chinese-rap-LoRA` | `config.json` + `pytorch_lora_weights.safetensors` | diffusers | **ACE-Step v1** |

The last one targets the **previous generation** (v1, May 2025) in a diffusers layout; it cannot work
with a v1.5 engine and the importer rejects it explicitly rather than failing obscurely later.

### 13.1 Three blockers, all of which had to be fixed

**1. The adapter had no `adapter_config.json`.** PEFT's `from_pretrained` reads r / lora_alpha /
target_modules from it, so the engine refused the directory outright. The README is a generic
diffusers template ("use `Eurobeats` to trigger the *image generation*") and the safetensors metadata
holds only `format=pt`, so the values had to be derived from the weights:

* **rank = 128** — read from the `lora_A` shapes (`128x2048`), which is reliable;
* **alpha is not recoverable.** It is not in the weights and not in the README. PEFT's own default is
  8, which would have given an effective scale of 8/128 = **0.0625** — an adapter that loads, binds,
  and is inaudible. We write `lora_alpha = rank` (scale 1.0) and expose the runtime scale, and the
  manifest records that alpha was inferred.

**2. Every key carried the prefix four times.** All 384 tensors began
`base_model.model.base_model.model.base_model.model.base_model.model.` — an artefact of nested PEFT
wrappers. PEFT matches against a single wrap's prefix, and a mismatch typically leaves the LoRA
layers at initialisation: **the adapter would load without error and contribute nothing.** The
importer collapses the prefix to one and reports how many keys it rewrote (384 for this adapter).

**3. Quantization made adapters impossible on this machine.** The engine auto-selects
`int8_weight_only` on this GPU tier (`gpu_config.quantization_default`), and `add_lora` refuses
outright:

```
❌ LoRA loading is not supported on quantized models. Current quantization: int8_weight_only.
```

The flag could not even be turned off: `--quantization` had `choices=["int8_weight_only",
"int4_weight_only", None]`, and argparse compares the given **string** against those choices, so the
Python `None` the default may hold was unreachable from a command line. `acestep_v15_pipeline.py`
now accepts `none`/`off` and maps it to `None` (**engine patch 5**), and `start-corefm-engine.bat`
passes `--quantization none`. This is not a hack around the engine: its own training handlers already
switch to a "training preset (disable quantization)" before starting, so unquantized was always part
of the intended flow. Cost is VRAM — measured at ~1.5 GB idle and ~4.9 GB with the adapter loaded,
against 12 GB.

### 13.2 What was built

```
ace-step-ui/server/scripts/hf_lora_import.py   download -> profile -> verify -> normalise -> manifest
ace-step-ui/server/src/routes/lora.ts          POST /import, GET /list, truthful load/scale/toggle
ACE-Step-1.5/loras/<name>/                     adapter_config.json + adapter_model.safetensors + manifest
ACE-Step-1.5/loras/.downloads/<name>/          the untouched original, always recoverable
```

The importer **verifies against the checkpoint actually being served** before writing anything: for
every target module it checks that `decoder.<module>.weight` exists and that the adapter's
`in_features` matches. It found no problems for either imported adapter, which is stronger evidence
than a successful load — it proves the shapes line up with the model we run.



### 13.3 Verified

```
profile:      rank=128  pairs=192  layers=24  targets=8  prefix_repeat=4
config:       synthesized  r=128  lora_alpha=128
normalize:    384 tensors, 384 keys re-prefixed
verification: no problems - every target module exists in acestep-v15-turbo with matching dims
load:         OK - LoRA 'super-eurobeats' loaded from .../loras/super-eurobeats
engine log:   LoRA adapter 'super-eurobeats' loaded (adapters=['super-eurobeats'], targets=192)
              - and no missing/unexpected-key warnings anywhere in the log
scale:        OK - LoRA scale (super-eurobeats): 1.00
toggle:       OK - LoRA disabled  ->  status active:false
list:         /api/lora/list returns both adapters with rank/alpha/repo/verified
```

`targets=192` is the load-bearing number: it is exactly the 192 LoRA pairs in the file, so every
tensor bound to a module. That is what proves the prefix normalisation worked - without it PEFT would
have matched nothing and still reported success.

A second adapter, `kemendev/russian-pop-lora`, imported cleanly with a **declared** config
(r=64, alpha=128). This caught one bug in the importer: `allow_patterns` originally downloaded only
`*.safetensors` and `README.md`, so the declared config was never fetched and a synthesised alpha=64
was written instead - halving the adapter's intended strength. `*.json` is now included.

### 13.4 The adapter demonstrably changes the output - and the first test was invalid

Hashing is the wrong tool here: three runs with the LoRA **off** and identical settings produced
three different SHA256s while being timbrally identical (see below), because encoder-level bytes
differ even when the audio does not. So a hash difference proves nothing, and an early "the hashes
differ, so the LoRA works" reading of mine was worthless.

The first feature-based comparison was *also* invalid, for a reason worth recording: it found no
effect (`between/baseline = 1.055`, i.e. group spread no larger than run-to-run spread) because the
adapter was **silently not enabled** - `set_use_lora` was raising inside its own try/except and
returning "✅ LoRA enabled" anyway (see 13.4.1). That test compared off against off.

With the enable actually working, three clips per group, same prompt and seed:

```
clip            secs   rms      centroid      file size
OFF 62d361d4   15.00  0.0889      2296           254.4 KB
OFF 1158b10e   15.00  0.0884      2296           254.7 KB
OFF 41ee0e29   15.00  0.0889      2299           254.6 KB
ON  13686aa8   15.00  0.1323      3152           317.8 KB
ON  ef2390af   15.00  0.1322      3155           318.0 KB
ON  e49c9037   15.00  0.1323      3153           317.4 KB

within-OFF 0.0000 | within-ON 0.0000 | between 0.0354   ratio between/baseline ~= 113000
```

Spectral centroid **+37%**, RMS **+49%**, file size **+25%** - a large, systematic and repeatable
shift, with essentially zero variance inside each group. The adapter is loaded, bound and audibly
active. Whether the result *sounds like Eurobeats* is still a listening judgement; the model card
ships `samples/base.wav` and `lora_ep*/sample.wav` for that.

#### 13.4.1 A third silent-success bug, this time inside the engine

```
WARNING set_use_lora:41 - Could not toggle adapter layers:
        Setting requires_grad=True on inference tensor outside InferenceMode is not allowed.
```

`enable_adapter_layers()` flips `requires_grad` on the adapter parameters, and the decoder is built
under `torch.inference_mode()`, so torch refuses that outside InferenceMode - every attempt to
re-enable a previously disabled adapter failed. The surrounding `except` logged a warning and the
function still returned "✅ LoRA enabled", so an inert adapter looked enabled. Fixed in
`acestep/core/generation/handler/lora/controls.py` (**engine patch 6**): the call now runs inside
`torch.inference_mode()` (where it is permitted) and a failure **returns a cross** instead of being
swallowed, so our `engineRefused()` check surfaces it as a 409.

After the fix the engine logs `LoRA adapter enabled` with no warning, and the comparison above is
possible at all.

### 13.5 Defects found in our own code while doing this

- `/api/lora/load` answered **`loaded: true` for an adapter the engine had just refused** - it never
  inspected the status string it received. All four mutating routes (`load`, `unload`, `scale`,
  `toggle`) had this flaw; they now detect the engine's refusal and answer **409** with its message.
  Same "silent success" class as the dataset save bug in section 12.
- `lora.ts` needed the same ESM `__dirname` fix as `training.ts`, and the `/init-model` route is a
  **501** by design (the engine registers service-init as a Gradio lambda with no callable name), so
  re-initialising the service with a different quantization over the API is not possible - hence the
  boot-time flag.

### 13.6 Using it

```
# import (or POST /api/lora/import {"repoId":"owner/name","name":"local-name"})
python_embeded\python.exe server\scripts\hf_lora_import.py --repo <owner/name> --name <local-name>

# the engine must be unquantized (now the default in start-corefm-engine.bat)
python_embeded\python.exe acestep\acestep_v15_pipeline.py ... --quantization none

# then, via the API
POST /api/lora/load   {"lora_path": "...\\ACE-Step-1.5\\loras\\super-eurobeats"}
POST /api/lora/scale  {"scale": 0.8}
POST /api/lora/toggle {"enabled": true}
GET  /api/lora/list
```

### 13.7 Selecting adapters from the Create tab

The Create tab's LoRA panel used to require typing a filesystem path. It now offers a **dropdown of the
adapters imported into the engine**, with:

- a **Refresh** control, and the list loading automatically when the panel is first opened;
- **Add from Hugging Face** (`owner/repo-name`) so an adapter can be pulled in without leaving the UI -
  it calls `/api/lora/import`, then refreshes the list and selects the new entry;
- a manual path field for adapters stored outside the engine's `loras/` directory (as of 13.8 this is an
  explicit **Custom path** mode, mutually exclusive with the dropdown, rather than a second live input);
- a detail line for the selected adapter: confirmation state, rank, alpha, source repo, and the
  engine's own error text if its last load failed.

**What "confirmed working" means.** Not just "the file looks right". The import step already verifies
every target module and shape against the checkpoint being served (`verification.ok`); on top of that,
`POST /api/lora/load` now records the outcome in the adapter's manifest as `lastLoad`, and
`GET /api/lora/list` reports `confirmed` only when **both** are true - i.e. the weights matched the
running model *and* the engine has actually loaded this adapter since. A freshly imported adapter is
therefore listed but marked **unconfirmed**, so it can be tried without being presented as safe.

Measured against the live stack:

```
before a recorded load:  super-eurobeats confirmed=False  verified=True  lastLoad=<none>
                         russian-pop      confirmed=False  verified=True  lastLoad=<none>
after unload + load:     super-eurobeats confirmed=True   rank=128  alpha=128  lastLoad=2026-09-21T05:56:28Z
                         russian-pop      confirmed=False  rank=64   alpha=128  lastLoad=<none>
```

That two-step is the point: `verified=True` alone would have marked `russian-pop` safe even though
nothing had ever loaded it, which is how an unusable adapter gets offered to users.

New i18n keys (`loraModel`, `loraRefresh`, `loraNoneImported`, `loraUnconfirmed`, `loraConfirmed`,
`loraConfigSynthesized`, `loraImportLabel`, `loraImportPlaceholder`, `loraImportButton`,
`loraManualPath`) exist in **all four languages** (en/zh/ja/ko), and the UI typecheck is clean.

Files: `components/CreatePanel.tsx`, `services/api.ts`, `i18n/translations.ts`,
`server/src/routes/lora.ts`.


### 13.8 Making the adapter choice unambiguous (2026-09-21)

The dropdown added in 13.7 was not usable in practice, and it could disagree with what was actually sent
to the engine. Three faults, all reproduced against the live stack:

1. **A stale default won.** `loraPath` started as `'./lora_output/final/adapter'` - a value matching no
   dropdown entry and pointing nowhere. The panel *displayed* the selected adapter while the Load button
   sent the default, so the engine was asked for a directory that did not exist.
2. **Signed out meant an empty dropdown, with no explanation.** `GET /api/lora/list` sits behind
   `authMiddleware` and returns 401 without a token, and `refreshLoraAdapters` returned early on a missing
   token - so the list rendered as "no adapters imported" and typing a path was the only way through. The
   list now always renders, and says that a sign-in is needed when that is the reason.
3. **"Loaded" was a local guess.** `loraLoaded` was set by the click that loaded an adapter and reset by
   any page or backend reload, while the engine kept the adapter bound for the rest of the process's life.

**The fix: one source of truth per request.** The dropdown and the manual field are now separate sources
behind an explicit **Imported model | Custom path** switch, and `loraEffectivePath` - the only value the
load call reads - is taken from whichever source is selected, so the other one cannot leak into the
request. The dropdown gained a real placeholder (`value=""`) and is bound to the *selected adapter* rather
than to a path string, so a selection matching no adapter renders as "Select a LoRA model..." instead of
silently displaying some other entry's name. Choosing or importing an adapter remembers it in
`localStorage`; on load the panel reconciles to the engine's adapter, else the remembered choice, else the
placeholder. New i18n keys `loraSourceImported`, `loraSourceCustom`, `loraNoneSelected`,
`loraSignInRequired`, `loraPathRequired` exist in **all four languages** (en/zh/ja/ko).

### 13.9 The engine now answers what is loaded (patch #7)

`get_lora_status()` already knew the truth (`handler/lora/controls.py`) - it was simply not reachable: the
Gradio app wired up the LoRA buttons but offered no way to *ask*. `events/__init__.py` now registers a
`demo.load` handler that returns that status as JSON under `api_name="lora_status"`, which also gives the
status box its initial value. `/api/lora/status` and `/api/lora/list` ask the engine first and fall back to
the local copy only if the engine cannot answer, and `/api/lora/list` additionally returns
`activeAdapterName` and the engine's raw payload, so a disagreement between app and engine is visible
rather than silent.

Measured: the named-endpoint count went 147 -> 148, and after loading an adapter and then **killing and
restarting the entire backend** (whose memory of the load was gone), `/api/lora/status` still reported
`loaded:true` and the list still named `super-eurobeats` - the exact case that used to show "unloaded".


### 13.10 unload_lora never restored the weights - it only said it did

The restore in `lifecycle.py` loaded a state_dict captured *before* PEFT wrapped the decoder back onto the
wrapped module with `strict=False`:

```
Missing keys:    layers.0.self_attn.q_proj.base_layer.weight    (for every adapted module)
Unexpected keys: layers.0.self_attn.q_proj.weight
```

PEFT keeps the original weight under `base_layer` and adds `lora_A`/`lora_B` entries, so the keys cannot
match without a remap; `strict=False` discarded every one of them, the two lists were logged as
`warning`s, and the function returned `✅ LoRA unloaded` either way. The adapter therefore stayed merged
into the weights while the caller was told the base model was back. Fixed by preferring
`PeftModel.unload()` (which restores the original modules by construction) and keeping the state_dict
route as a fallback that remaps `...x.weight` -> `...x.base_layer.weight` and **returns an error instead
of ✅** if any key is still missing or unexpected afterwards.

The VRAM line was wrong in a way that concealed this: it printed `freed: -3.10GB`, because it compared a
CPU-offloaded decoder against a GPU-resident one. It now reports both readings and what the difference
actually contains, rather than a "freed" figure that could be negative.

**Verified end to end** - same seed, same 12s instrumental, engine restarted onto the patched code:

| run | sha256 (first 16) | vs base1: max / mean abs sample difference |
|---|---|---|
| base1 (unloaded) | f4ffe99d6dd15682 | - |
| lora1 (adapter loaded) | 186e1f66cc77e505 | 1.3498 / 0.06309 |
| base2 (after unload) | d092d8df7510247f | 0.0556 / 0.000484 |
| base3 (base control) | 26be75c96bcaae4b | 0.0671 / 0.000497 |

Audio is not bit-reproducible on this GPU, so equal hashes are not the test. The test is that the
post-unload run differs from the base run **no more than a plain repeat base run does** (mean 0.000484 vs
0.000497 - the same noise floor), while the adapter-active run differs by ~130x more. Unload returns the
exact base weights; the engine log shows `Unloading PEFT adapter via PeftModel.unload()` with no
missing/unexpected keys.

### 13.11 Still open

- The other three repos are **not yet imported**: the nested-epoch one (`2600A`) needs the importer
  to descend into `adapter/` (it picks the shallowest, largest `.safetensors`, so this needs
  checking), the Naija one needs its config synthesised and declares `acestep-v15-base`, and the
  chinese-rap one is v1 and unusable by design.
- **Base mismatch**: we run turbo, while `tarn59` and the Naija adapter declare non-turbo bases. The
  modules and dims line up exactly, so they load and apply - but the effect may differ from the
  author's intent, and that is worth measuring rather than assuming.
- **Licences differ** and matter for anything commercial: `tarn59` apache-2.0, `2600A` cc-by-4.0,
  Naija **CC-BY-NC-4.0 (non-commercial)**, `kemendev` none declared.

## 14. The lyric writer was repeating one line into half the song (2026-09-21)

Reported as "the lyric generator is falling into a hyper repetitive writing style". It was, and it was
measurable: across the 120 designs of the last batch the average lyric was **39% duplicated lines**,
47% of designs were ≥40% duplicated, and 29% had a *single line* sung six or more times.

### 14.1 The cause was structural, not linguistic

Every `device` style - a style that repeats on purpose - put its key line in **every section of the
song**. `hook-variation-payoff` is the clearest case, and its arrangement was:

```
Intro    [claim]                         1
Verse 1  [claim, context, context]       1
Chorus   [claim, claim, variation]       2
Verse 2  [context, context, claim]       1
Chorus   [identical, via repeatOf]       2
Bridge   [variation, claim]              1
Outro    [claim]                         1
                                 claim = 9 of 16 lines
```

The output was 16 lines, 6 distinct, one line 9× - *identically* in en/de/fr/pt/ko/zh, which is the
signature of an arrangement rather than of a language. `refrain-mutation` was worse at 11×,
`object-symbol` and `groove-return` at 8× (53% of the song).

Style *selection* is not implicated and is healthy: all 21 styles were used across that batch
(9, 9, 8, 8, 7, 7, ...), so it was never rotation collapsing onto repetition styles.

### 14.2 Why no gate had caught it

`validateLyrics` measured repetition **inside one section only** (`repetition`, `repeatedLines`), and
`scripts/agent-spread.ts` *required* that number to be 0 for a device style. A hook sung once in each of
seven sections is invisible to that measurement - the gate could not see the defect it was guarding
against. Meanwhile the same gate's floors (claim 4+, refrain 3+, object 3+, premise 2+) documented the
*intent*, so 9× was 2.3× the contract and nothing could tell.

### 14.3 What changed

- **The measurement.** `LyricValidation` gained `maxLineRepeats`, `maxLineShare`, `distinctLineShare` and
  `mostSungLine`, counted across the whole song with the same notion of sameness the writer uses
  (lower-cased, parentheses stripped - so a line and its parenthesised backing-vocal echo are one line).
- **The ceiling.** `agent-spread.ts` now fails a style whose most-sung line exceeds 40% of the song
  (35% for a fault style) or whose distinct-line share falls under 50% (45% for fault). The reasoning is
  in the source next to the constants: legitimate styles measured 23-29% for one line, the drifted ones
  50-56%. The distinct-share bar deliberately sits *below* the legitimate range, because a repeated
  chorus is a real cost - a 3-line chorus sung twice spends a fifth of a short song on itself, and that
  is songwriting, not a defect.
- **Five arrangements fixed.** `hook-variation-payoff` (9× → 5×: the claim now arrives with the chorus
  instead of opening both verses, and the chorus is `[claim, reinterpretation, turn]` rather than
  `[claim, claim, variation]`), `refrain-mutation` (11× → 5×), `object-symbol` (8× → 5×, and its bridge
  no longer draws the parenthesised twin of the chorus turn), `groove-return` (8× → 4×, exactly the floor
  its engine asserts) and `one-line-premise` (7× → 5×). Every declared engine is intact: the claim still
  returns 4+ times, the refrain is still word-for-word, the object still passes four contexts, the
  pattern still returns unchanged after the break, and the premise still closes the song.

### 14.4 Verified

| | before | after |
|---|---|---|
| designs where one line takes >40% of the song | 47 of 296 | **0 of 30** |
| designs where one line takes >50% | 12 | **0** |
| worst line share, `hook-variation-payoff` | 56% | 31% |
| worst line share, `object-symbol` | 53% | 36% |
| worst line share, `refrain-mutation` | 52% | not in the worst eight any more |
| `agent-spread.ts` | 329 failures under the new bar | **PASS, 0 failures** |

Measured end to end on a *copy* of the live database with the same briefs (`DB_PATH` pointed at a
throwaway copy, so the real concepts were untouched); the "after" column is 30 fresh designs through the
same code path. `lyric-pack-acceptance.ts` (9 packs), `lyric-validate-suite.ts` (40 checks) and
`subject-spread.ts` all pass, and `tsc --noEmit` is clean.

Two honest notes. Total duplicate-line share is **not** the headline number: the repeated chorus keeps it
near 39%, and it rose slightly here only because the songs are shorter (13.8 lines on average versus
19.9) now that the hook is no longer padding them out - the sharp metric is how much of a song one line
takes. And the concepts already stored in `data/signals.db` still hold the old, repetitive lyrics: they
are historical records, and every *new* design uses the fixed arrangements.

### 14.5 Not done

- The same hook strings and titles still recur *across* songs (shared banks) - "You and I say it first
  for once" and "todo mundo, a gente pega o caminho longo" each appear in more than one design. If
  "every song sounds like the last" is also part of the complaint, that is a separate lever: excluding
  recently used hooks and titles within a run, the way subjects and styles already rotate.
- `ja` still has no lyric pack (it falls back to English), so passing `ja` to
  `lyric-pack-acceptance.ts` fails. Pre-existing and unrelated to this change.


## 15. The stored designs were rewritten from the sample data (2026-09-21)

Section 14 fixed the *writer*; every design already in `data/signals.db` still carried the
hyper-repetitive lyrics it was built with. They have now been rewritten from each market's own
sample data - the same inputs the single-concept reroll endpoint uses.

### 15.1 What the rewrite is

`npm run rewrite-lyrics` (CLI `rewrite-lyrics`, `src/design/rewrite.ts`) re-runs the lyric half of
the design for every stored concept: the market's latest brief `topTerms` and its flavour `themes`,
plus the concept's own genre, requested language, tempo and meter. It touches nothing that is not a
lyric - title, style prompt, key, duration, batch size and engine seed are left alone.

Four deliberate properties:

- **the writing style is kept** unless `--redraw` is passed, so a rewrite fixes how the song is
  built without silently changing which style built it. When the style is kept, its recorded
  *source* (rotation, affinity) survives too: `chooseAgent` reports a forced style as `seeded`, and
  "chosen by seeded" for a style that was never drawn again would be a small lie in the UI;
- **the draw is seeded from the concept id plus the run seed** (`seedFromString(id:seed)`), so one
  run is reproducible and the next run differs. Re-running with the same seed produced byte-identical
  lyrics, which is how the double-write below went unnoticed until the audit;
- **rotation is per market and accumulates through the run**, exactly as the designer does it, so a
  batch does not hand every design in a market the same subject;
- **the rationale is rebuilt.** It names the subject, the writing style and the singability score,
  all three of which a rewrite changes - a rationale naming the previous subject is a lie the Trends
  panel would repeat. `updateConceptLyrics` gained an optional fifth argument for this; callers that
  omit it (the reroll endpoint) keep the old prose.

Designs written before writing styles existed (130 of the 336 had no `lyricAgent` recorded) get a
freshly drawn style, which is why the per-style counts differ before and after.

### 15.2 The npm flag trap, and why the first "dry run" wrote

`npm run rewrite-lyrics -- --market us --dry-run` looked like a dry run. It was not: npm treated
`--market` and `--dry-run` as *its own* options even after `--`, set `npm_config_market` /
`npm_config_dry_run`, and passed `us` through as a bare positional argument - so the script saw
neither flag and rewrote all 336 designs. Nothing was lost (the run is idempotent, and the result is
what was wanted), but a command that answers `--dry-run` by writing is not acceptable, so:

- the CLI now reads both spellings (`--dry-run` and `npm_config_dry_run`, same for
  `market`/`seed`/`limit`/`redraw`), via `envFlag`/`envValue` in `src/cli/args.ts`;
- it prints the mode it resolved - `rewrite-lyrics | DRY RUN - nothing will be written | market: br
  | seed: 1 | styles: kept | limit: 1000` - before doing anything;
- a market that is not an ISO 3166-1 alpha-2 code (npm's bare-flag `true`, for instance) is refused
  with the reason and the two correct invocation forms, instead of silently rewriting nothing.

Verified against a copy of the database with a row's status flipped as a tripwire: the direct
invocation, `npm run ... -- --market=br --dry-run` and `npx tsx src/index.ts ...` all left the row
untouched, and the writing form changed it back. The README's "useful flags" note was wrong about
`--` being sufficient and now says this.

### 15.3 What the data looks like now

Baseline and result, measured with `npm run lyric-audit` (the new `scripts/lyric-repetition-audit.ts`,
which reads *stored* designs through the validator's own metric rather than a second implementation):

| | before | after |
|---|---|---|
| designs with one line over 40% of the song | 57 of 336 | **0 of 336** |
| worst example | `hook-variation-payoff` 9x of 16 (56%) in 8 markets | 6x of 15 (40%), at the ceiling |
| average single-line share | 21.9% | 23.5% |
| average lyric length | 19.2 lines (13.3 distinct) | 15.3 lines (10.2 distinct) |

The average single-line share rose slightly while every breach disappeared: the old average was
diluted by ~230 designs with no recorded style and short repeats, and the songs are now shorter
because the removed padding *was* the repetition (a 5-line hook no longer holds a 20-line song
open). All 336 are `designed` before and after, so no render state was disturbed; the 44 recorded
runs are untouched.

A spot check of one rewritten concept (`us`, `Electric Weather`): verse 1 no longer opens on the
claim, `lyricStructure` shows the new arrangement (`Verse 1 -> ["context"]`), `lyricAgent` is the
same style with `lyricAgentSource: rotation` preserved, `params.rerolledAt` marks the rewrite, and
the rationale was rewritten to the new subject and singability score.

**Backup**: `data/signals.pre-rewrite-20260921-150857.db` (41.8 MB, gitignored with the rest of
`data/`) holds the database as it was immediately before the bulk write - it already contains the
accidental first write, whose output is identical to the final one.

All gates still pass after the change: `agent-spread` (0 failures), `lyric-validate-suite` (40
checks), `subject-spread`, `lyric-pack-acceptance` for the nine real packs, and `tsc --noEmit`.

### 15.4 Running it again

```bash
npm run lyric-audit                                 # what is stored now
npm run rewrite-lyrics -- --market=us --dry-run      # preview one market
npm run rewrite-lyrics -- --seed 2                   # a different draw, same sample
npm run rewrite-lyrics -- --redraw                   # draw fresh writing styles too
```

It is not yet wired into `cycle`: a cycle designs *new* concepts, which already use the fixed writer.
Worth adding if the intent is "refresh stored lyrics on every cycle"; the command exists so that
choice is a flag rather than a script.


## 16. "Based on the sample data" meant the signal data (2026-09-21)

Clarified after section 15: the sample the rewrite should follow is the **collected signal data** -
the chart rows - not the derived brief prose and certainly not a static table. Tracing every input
the lyric writer receives showed one input that was not the signals at all.

### 16.1 What was already signal data, and what was not

| Lyric input | Source before | Source now |
|---|---|---|
| `terms` | `topTerms(rows)` - mined from the signals | unchanged (already signal data) |
| `themes` | `flavorFor(market).themes` - a **static region table** | `chartThemes(rows)`, mined from the sample, leading; the static table stays behind it |
| `genre`, `tempo`, `language` | the brief, built from the signals | unchanged |
| subject | matched from terms + themes | unchanged, but the themes now lead with chart phrasing |

So the terms were the chart's own words and the themes were a hand-written table; the "local
flavour" that decided what a song is *about* never came from the chart at all.

### 16.2 `chartThemes`: the sample's own phrasing

Adjacent content-token pairs from the market's titles (the same tokeniser and stopword list the
trend pipeline uses), rank-weighted so the top of the chart counts for more than the tail, requiring
recurrence in at least `max(2, 6% of the sample)` tracks - a phrase one artist used once is a title,
not a theme - with artist tokens removed and CJK/Hangul pairs joined without a space (an inserted
space would not match the title it came from). Persisted on the brief (`market_briefs.themes`, added
via `ensureColumn`, so older briefs simply have none) and reported in the brief summary as
"recurring themes".

### 16.3 Why the static table was not deleted - measured, not assumed

Feeding the writer **only** the mined words was tried first, and it is worse than it looks:

```
market   signal only   signal + baseline   flavour only
us       24/24 chart-topic   24/24            24/24
gb        0/24              24/24            24/24
fr        0/24              24/24            24/24
de        0/24              24/24            24/24
br        0/24              24/24            24/24
jp        0/24              24/24            24/24
kr        0/24              24/24            24/24
cn        0/24              24/24            24/24
in        0/24              24/24            24/24
ng        0/24              24/24            24/24
```

24 seeds per market, `chart-topic` = the subject was matched from market material. Chart words like
`need`, `love`, `last` intersect no subject keyword, so with the mined words alone the matcher finds
nothing and nine of ten markets fall back to rotation/seeded - the curated phrases are what make the
catalogue reachable. Both layers are therefore kept, **signal first** (the mined phrase is what gets
recorded as the match when it wins), and `params.lyricThemeSource` / `params.lyricThemes` record
which led and what the list was.

### 16.4 The chart's word now reaches the lyric in every language

`pickTopicWord` takes a chart term in the pack's own script and renders it as the intro ad-lib - the
one place a market's own vocabulary enters a lyric verbatim. It was wired into the `introLine` of
**only three of nine packs** (`en`, `ko`, `zh`); the other six ignored it, so the same signal
produced `(love)` / `(need)` in some markets and a generic subject phrase in others. All nine packs
now prefer `ctx.topicWord`, which is what turns up in the data: `de -> (hier)` (a German chart word)
where the German pack previously always used its fallback.

`topicWord` was also **not recorded anywhere**: the first measurement of it read 0 of 336 because the
field is not part of `lyricProvenance` even though the plan carries it. It is now recorded, so the
ad-lib is auditable per concept rather than only visible by reading the lyric.

### 16.5 Re-run and verified

The 336 stored designs were rewritten again with the signal-led themes and the uniform ad-lib:

- designs with a chart-word intro ad-lib: **41 of 336**, unchanged in count (the line exists whenever
  a style has an Intro and the chart has an in-script word; what changed is that it is now the
  market's word in every language), spread across all ten markets: `{gb 2, jp 5, us 6, de 5, fr 7,
  br 3, kr 2, cn 5, in 4, ng 2}`
- `topicWord` recorded on **336 of 336**; `lyricThemeSource` = `signal` on 330, `flavour` on 6
- subject source across the library: **chart-topic 302, rotation 34** - the signal already drove it
- repetition audit unchanged: **0 of 336 over the line-share ceiling** (avg 33.9% duplicated lines)
- gates: `agent-spread` 0 failures, `lyric-pack-acceptance` 9 packs, `lyric-validate-suite` 40
  checks, `tsc --noEmit` clean

A German concept now records the whole chain: `lyricThemeSource: signal`, themes
`["movin'","hier","blind","brightside","self","aware","beauty","beat","freedom","movement"]`,
`topicWord: "self"`, subject `city-and-work` matched by `movement`.

### 16.6 What this does not fix

- **Mined themes are thin for most markets.** A 50-track sample rarely repeats a phrase pair, so
  `chartThemes` falls back to the sample's top single tokens (`need`, `love`, `talk`) for eight of
  ten markets; they are signal data, but they are not phrases, and they don't match the catalogue.
  Realising the intent fully needs either deeper samples or a chart-vocabulary layer that maps common
  chart words onto the subject catalogue - a decision about the subject engine, not about plumbing.
- **Artist names can leak into terms**, and therefore into an ad-lib: the Japanese chart's terms
  include `awich` and `paledusk`, because a title credits a collaborator that no row lists as the
  artist, so the artist-token filter cannot see it.
- **Styles without an Intro** (object-symbol, call-response, ...) have nowhere to put an ad-lib, so
  the signal's vocabulary cannot appear in them at all.


## 17. A dislike that moves the weights (2026-09-21) - Layers 0 and 1

Asked for: a dislike button so that "active weight decisions" are augmented by user preference over
previously output content, as the first step towards a soft-tuning loop that periodically emits a new
model edition. That is a four-layer system; the two layers that change behaviour without a GPU were
agreed as the first slice and are the ones below.

### 17.1 What existed, and the two gaps

| | app (`ace-step-ui`) | aggregator (`signal-aggregator`) |
|---|---|---|
| Feedback | `liked_songs` - a **like toggle only**, never read by anything | `ratings` (0.2-1.0 per run) → `learnFromScore` |
| Learning | none | `delta = 0.25 x (score - 0.5)` on `genre:`/`bpm:`/`key:`/`tag:`, clamped `[0.25, 3]` |

Two gaps: there was **no negative signal anywhere**, and the *lyric-side* keys (`agent:`, `subject:`,
`language:`, `theme:`) were recorded on every concept and never learned or read back. A rating of 0.2
did damp, but it could not distinguish "not a hit" from "never do this again", and it could not be
attributed to a part of the song.

### 17.2 What the learner does now

- **Asymmetric.** A rating takes a step proportional to its distance from neutral; a **dislike takes
  a full negative step regardless of any score beside it**. Repeats compound: three dislikes on the
  same key take it to the 0.25 floor, i.e. a 4x reduction in how often that choice is drawn.
- **Reason attributed.** `feedback.reasons` confines the update to what it blames:
  `mix` → production tags only, `lyrics` → writing style + subject (+ themes),
  `genre` → genre, `tempo` → tempo class, `language`/`pronunciation` → language.
  With no reason named, every feature the song carried moves - the blunt version, which is why the
  ledger counts unattributed dislikes separately.
- **New keys, consumed.** `agent:<id>`, `subject:<id>`, `language:<code>`, `theme:<phrase>`, and
  they are read where they must be to matter: `chooseAgent`, `chooseSubject` and the market's language
  draw all take learned weights. With no feedback every weight is 1, so behaviour and every gate are
  unchanged until somebody dislikes something.
- **One learner.** A run rating and a song dislike go through `scoring/feedback.ts`; `learnFromScore`
  now delegates to it, so the two paths cannot drift.

### 17.3 Verified end to end (throwaway database copy, port 3009)

```
dislike, reason "lyrics"  → agent:hook-variation-payoff -> 0.75  subject:city-and-work -> 0.85
                            theme:late night -> 0.925  theme:long way home -> 0.925
dislike, reason "mix"     → tag:country -> 0.885  tag:storytelling -> 0.885
                            tag:acoustic warmth -> 0.885  tag:acoustic guitar -> 0.9  tag:brushed drums -> 0.885
                            (nothing else moved - no genre, tempo, agent or subject)
ledger                    → 3 recorded (1 like, 2 dislikes, 0 unattributed), reasons mix x2, lyrics x1
effect on design          → hook-variation-payoff 7 of 120 designs -> 5;  city-and-work 23 -> 19
gates                     → agent-spread 0 failures, subject-spread, 40 validator checks, 9 packs
```

The reason for the modest 7→5 shift is arithmetic, not a ceiling: one dislike is a 0.75 weight against
twenty other styles. It compounds with repeats, which is the intended shape - one click should not
eliminate a style.

### 17.4 Shipped in this slice

`POST /api/feedback` (verdict + optional score, reasons and a feature bag, so a song with no run is
learnable), `GET /api/feedback` (ledger + summary), `ratings.verdict`, `npm run feedback`,
`has /api/feedback` in the API table, and the weight consumption described above. Committed as
`d3365d5` in the aggregator, subtree-merged into the app at `ae071a5`.

### 17.5 The hard no in the app - delivered

`song_feedback` (`user_id, song_id, verdict, reasons`, one row per pair) sits beside `liked_songs`
rather than replacing it, and `POST /api/songs/:id/feedback` reconciles the two: a dislike clears the
like, a like clears the dislike, `verdict: 'none'` clears whatever is set (a hard no has to be
takeable back). `GET /:id/feedback` returns this user's verdict plus the prompt it answered, and
`GET /feedback/mine` bulk-loads them so the buttons are correct after a reload. The button sits beside
every like control in the player (all four layout variants), state hydrates from the bulk read, and a
failed write reverts the button rather than claiming a verdict the server does not have.

`songs.prompt_id` now records the prompt a response belongs to, so the variations of one batch share
it - a verdict on one response is not a verdict on the prompt, and the training corpus needs the pair.
Existing rows stay null (the link was never stored) and a guarded `ensureColumn` adds the column,
because SQLite has no `ADD COLUMN IF NOT EXISTS` and the schema runs on every start.

**Verified (17 checks, on a throwaway copy of the database):** a dislike records with its reasons and
leaves `like_count` alone; a like clears the dislike and increments it; `none` clears both and restores
the count; a dislike removes an existing like; an invalid verdict is refused; the bulk read reflects a
dislike and stops reflecting it after clearing.

### 17.6 Two hazards in the pool shim, found by hitting them

`db/pool.ts` rewrites **every** `$n` to `?` and binds the values by their order of appearance in the
SQL text. The numbers are decoration:

- **A repeated `$n`** (using `$3` twice, which is idiomatic in Postgres upserts) asks for one more value
  than was passed: `RangeError: Too few parameter values were provided`. Fixed by using SQLite's
  `excluded.verdict` form, which needs each placeholder once.
- **`$2` appearing before `$1`** silently **swaps the values** rather than failing. A left join on
  `f.user_id = $2` with `WHERE s.id = $1` bound the song id to the user and the user id to the song,
  so the query returned no rows and the endpoint answered 404 for a song that plainly exists. Fixed by
  ordering the placeholders to match the values, with a comment, since the next person to write a query
  here will reach for numbering.

A scan of the 74 parameterised SQL strings in `server/src` found no other instance of either pattern
(the two hits were this session's explanatory comment and a false positive on a query that answers 200).

### 17.7 Reasons: what was wrong, not just no - delivered

A hard no now carries optional reasons, offered as a chip row that appears once the dislike is set, so
the button stays a single click and the reasons refine an existing complaint rather than gating it.
Tapping a chip re-sends the whole set (optimistic, reverting on failure like the verdict itself), and
clearing the dislike clears its reasons. Nine ids across four languages (en/zh/ja/ko), chosen to be the
ids the aggregator's learner maps to weights: off-prompt, bad-lyrics, mix, wrong-genre, tempo, vocals,
repetition, language, not-my-kind.

**Two of those ids were not modelled at all**, and that exposed a hazard worth naming: a reason set
mapping to no key family moved *no weights* while the verdict was recorded, with nothing in the
response to say so - a typo would have looked like the learner simply disagreeing. The learner now
treats an unmapped reason set as unattributed (blame everything the response carried) and reports the
unrecognised ids in its `applied` list. `off-prompt` gained a real mapping - genre, subject and tags,
the layers that turn a prompt into a style prompt - and `not-my-kind` is deliberately mapped to
nothing, which is what routes it into that fallback rather than pretending to be specific.

**Verified.** Attribution: off-prompt moves genre, tags, subject and theme but never the writing style
or the language; mix moves production tags only; bad-lyrics moves the writing style and subject;
not-my-kind and an unmodelled id both blame everything, the latter saying so. Sizing is numeric rather
than asserted: a dislike moves a weight **0.25** where a 0.2 rating moves **0.075**, so four hard nos
reach the 0.25 floor. App side: 11 checks covering a reason stored, a second joining it, one taken
back, the bulk read carrying verdict plus reasons, a like clearing both, and the legacy route clearing
the hard no.

**A reconciliation hole, found by asking what a like does to a dislike:** the older `POST /:id/like`
route touched only `liked_songs`, so liking a song that had been rejected left the hard no in place - a
song could be both, and the learner would read two opposite verdicts as equivalent. The server now
clears a dislike on that path as well, and the app sends likes through the verdict endpoint so there is
one reconciliation path rather than two.

### 17.8 Still to build after this

1. **Attribution** - forward the verdict to the aggregator (with a market) so app verdicts reach the
   market weights. **Delivered in 17.10.**
2. **Layer U** - `user_weights`, retry avoidance for a rejected prompt, Create-tab defaults consulting
   the profile, and a confidence blend with the market weights so a two-verdict profile does not
   override two hundred. **Delivered in 17.11.**
3. **Market promotion thresholds** (distinct users, window, decay, rate limit) and shadow mode.
   **Delivered in 17.10 and 17.13** - the window and threshold in 17.10, the decay in 17.12, the rate
   limit in 17.13.
4. **A decay for damped weights.** The tests drove a key to the 0.25 floor within four hard nos and it
   stays there; without a slow return toward 1, a handful of early opinions would shape a market for
   ever. This is the strongest argument for the decay that was planned but not built. **Delivered in
   17.12** - and it applies to the listener's own profile too, which Layer U made the sharper case.
5. **Editions** (Layer 2) - designed in 17.9, not built.

### 17.9 The soft-tuning loop (Layer 2) - designed, and now begun in 17.14

Editions registry (`ordinal, base edition, status candidate|adopted|retired, feedback window, dataset
hash, hyperparameters, adapter path, win rate`), an orchestrator that turns the feedback ledger into a
training mix, `/preprocess` → `/training_wrapper` with `resumeCheckpoint` = the current edition
(consecutive tuning, not from scratch - the engine already takes the argument) → `/export_lora` →
candidate → **adoption only on a win against the incumbent on held-out preferences**, and each song
records which edition produced it so feedback on edition N trains N+1.

Two things are non-negotiable there, and they are the reason Layer 2 is a project rather than a
script: training on your own liked output **collapses** (the mix has to keep the signal-derived chart
material and the curated baseline in it, and a frozen reference edition has to measure drift), and a
dislike signal makes the gate more important, not less - dislikes will teach it to avoid everything
if the only thing it learns from is what people did not like.

### 17.10 Attribution and the agreement gate (2026-09-21)

The verdicts and their reasons existed but stayed app-side; the aggregator's learner was ready and
idle. This slice joins them, and adds the gate that has to exist before they can be joined - forwarding
verdicts with no gate would have handed a market's weights to the first listener who found the button,
which is the exact failure the plan was written to avoid.

**Attribution.** `conceptToBody` (`signal-aggregator/src/pipeline/submit.ts`) now sends `market`,
`conceptId`, `runId`, `primaryGenre`, `lyricAgent`, `lyricSubject`, `lyricThemes` and `designSeed` with
every render, and `run.ts` passes the run id it just created. None of it reaches the engine - the UI
builds the Gradio argument list from a fixed set of names - but the app stores the request verbatim on
the job and on every song it produces, so a verdict on *audio* can name the market and the writing
style, subject and language that produced it.

**Pairing.** `songs.prompt_id` was added in 17.5 and never filled; the generate route now sets it to the
job id, so all variations of one generation share it. A complaint can be attached to a prompt as well as
to a response, which are different complaints needing different answers.

**The gate** (`src/loops/promotion.ts`). A verdict is planned (pure - `planFeedback`) and recorded as one
*row* per weight key it blames plus one *vote* per key in `feedback_votes`, carrying the delta it asked
for and the rater. Votes reach the weights only when `FEEDBACK_MIN_USERS` (default 3) **distinct** raters
agree on the same key+sign within `FEEDBACK_WINDOW_DAYS` (default 30); a promotion applies the sum of the
agreeing votes (still clamped to 0.25-3.0) and marks them used, so the next promotion counts only what
arrived since. `learn: false` writes no votes at all - a vote is the promise to act, and that flag
declines exactly that. `FEEDBACK_PROMOTE=false` reports every group as pending and writes nothing
(shadow mode).

**Retraction.** `verdict: 'none'` finds the caller's most recent verdict on the same response, releases
the votes that never crossed and *reverses* the votes that did (opposite delta). Because weights are
clamped, a reversal cannot always land on the exact earlier value - the response reports the value it
reached, and the notes say so.

**App side.** `POST /api/songs/:id/feedback` forwards after the local verdict is committed, with
`rater: app:<user id>`, `sourceId: <song id>`, the chips' reasons, and the provenance read back out of
`generation_params`. The aggregator is a second local service: a failure is *reported* (`learning.ok:
false`, `learning.error`), never raised - a listener's hard no must not fail because another process is
not running. A song with no market is still reported with `learn: false`, so the corpus is complete and
becomes learnable if it is ever attributed. New config: `AGGREGATOR_URL` (default
`http://localhost:3002`), `AGGREGATOR_TIMEOUT_MS` (5000).

**A real foot-gun found while testing.** `bool()` in the aggregator's config did not trim, and
`set FEEDBACK_PROMOTE=true && next` - a normal shell idiom - stores `"true "` **with a trailing
space**, which read as false. The flag silently did nothing, which for this flag means "learning is on
when you thought you had switched it off" (or off when you thought it was on). Now trimmed, with the
reason in the comment.

**Verified.** 19 checks against a throwaway copy of the live database on port 3099 (`FEEDBACK_MIN_USERS=3`):
one rater records 13 votes and moves nothing; the same rater judging a second response stays at one
rater while their vote count grows; two raters are still short; the third promotes, all 13 keys move,
pending clears; a fourth starts the count over; retracting a promoted verdict reverses it exactly; and
the ledger separates recorded / promoted / pending. Two more instances proved the escape hatches:
`FEEDBACK_PROMOTE=false` records and reports with zero promotions and untouched weights, and
`FEEDBACK_MIN_USERS=1` applies a single verdict at once (9 keys, one step each). 12 checks end to end
through a second app backend (port 3091) pointed at the gate: a `mix` dislike on an attributed song
moved **only** `tag:*` keys, the ledger shows `source: app`, the rater and the reasons, retraction
reversed the tag keys back to 1, a market-less song was reported with `learn:false` and moved nothing,
and with the aggregator stopped the verdict still returned **HTTP 200** with the verdict stored locally
and `learning.ok:false`. Gates unchanged: `agent-spread` PASS, `lyric-validate-suite` 40/40,
`subject-spread` PASS, 9 packs PASS, both typechecks clean. Live database migrated in place
(`feedback.rater`, `feedback.source_id`, `feedback.withdrawn`, `feedback_votes` table), live aggregator
restarted on the patched code with its `--schedule`, all four services up, ledger empty - no test data
was written to anything real.

**Known properties, stated rather than hidden.** Agreement is counted in people and magnitude in votes,
so one listener judging many responses adds magnitude without adding agreement; the bounds and the
pending decay in 17.8 item 4 are what keep that from compounding without limit. And a single-listener
install sees verdicts pile up as `pending` with no weight movement until `FEEDBACK_MIN_USERS=1` is set -
the gate is deliberately conservative for a multi-listener deployment and deliberately configurable for
a solo one.

**Still to build after this:** Layer U (per-user weights, retry avoidance, the confidence blend), the
decay, the rate limit, and Layer 2. The next slice is Layer U - the half of the plan that makes a hard
no act immediately for the person who gave it, which is what the user asked for: the market can wait for
agreement, the individual cannot.


### 17.11 Layer U: the individual acts at once (2026-09-22)

The gate in 17.10 answers "what should the *market* hear", and by design it makes one listener wait for
agreement. That is right for a market and wrong for a person: a hard no on your own generation should
change the very next thing you are offered. So the same verdict now has two destinations with two
different rules - the market waits, the listener does not.

**One learner, two scopes.** `planFeedback` no longer requires a market (scoping is the caller's
business): the plan feeds the gated market votes *and* `user_weights`, a per-rater table using the same
key grammar and the same 0.25-3.0 bounds. It is written on every verdict, immediately, with no
threshold and no window. Its doc now says why one plan has three destinations (the immediate run-rating
path, the gated market votes, the listener's own profile) rather than two.

**A market-less verdict teaches too.** `learn: false` still means "record only", but the plan is no
longer suppressed when there is no market, so a Create-tab verdict moves the listener's profile even
though it has no market to reach. The app stopped sending `learn: Boolean(market)` accordingly - its
verdicts always teach the person, and only reach a market when there is one and enough people agree.

**`next-take`: another take, under one rule.** `src/design/nextTake.ts` decides what a retry changes,
and it obeys *only change what the machine chose, never what the person wrote*. A design the loop
authored can have its writing style, subject, genre, production tags, key and tempo band changed; a
prompt the listener typed can have its seed, key, tempo and production tags changed but **not its
words**, and the reasons that cannot be acted on (`language` always; `genre` on a user-authored prompt)
are reported in `unactionable` rather than silently dropped. Production tags are dropped lowest-weight
first, so the ones this listener has objected to go before the ones they have never judged; a writing
style is picked preferring one their profile has not damped; the tempo moves a whole *band*, because a
retry that sounds the same is not a retry.

**A writing-style change rerolls the words.** If the retry changes the writing style it calls the
loop's own `reroll-lyrics` for the design and uses the returned lyrics, because a song whose params
claim one style while its lyrics follow another is worse than not changing the style. When that cannot
be done the style is left alone and the note says so - the test showed exactly that path when the
concept was missing.


**Where the retry avoids repeating itself.** Every take's seed is excluded: this song's own seed always
(a retry is by definition a response to being refused), plus the seeds of every other take the listener
has rejected in the same chain (`prompt_id = root OR json_extract(params,'$.retryRoot') = root`). Two
limits are stated rather than hidden - a take whose seed was *random* does not record which seed it
used, and songs from before `prompt_id` was recorded have no chain - and both are reported in the note.
The chain is written into the new song's params (`retryOf`, `retryRoot`, `retryAttempt`, `retryReasons`,
`retryExcludedSeeds`, `retryNote`, `retryUnactionable`).

**In the app.** `POST /api/songs/:id/retry` (with `dryRun` for inspection) plans and queues through the
same `createGenerationJob` the generate route now uses - extracted into `services/generation.ts`
precisely so a retry cannot queue a job differently from a first attempt. `GET /api/songs/profile/me`
exposes the profile with a `confident` flag. The player shows **Try another take** beside the reason
chips once a response has been refused (a separate action from the verdict, so recording "no" does not
oblige anyone to render again), and the new take appears in the list and is polled like any other
generation. The Create tab gained a suggestion row - *Your taste: more of X, less of Y* with a **Use**
button - which appears only when `confident`, and only ever edits the style field when clicked: a prompt
that rewrites itself under someone's hands would be worse than no suggestion at all. New i18n keys in
all four languages (en, zh, ja, ko).

**Verified.** 22 checks on a throwaway database copy (port 3099, `FEEDBACK_MIN_USERS=3`), whose point is
that the two layers behave differently: one dislike left the market at `pending 1/3` with **nothing
applied** while the listener's profile moved at once (`agent:... -> 0.75`); the profile reported
`verdicts: 1` with objections and no preferences; a market-less *like* still taught the profile and
created no votes; `next-take` moved 96 -> 78 BPM with the rejected seed excluded; a `bad-lyrics` retry
on a machine-designed take switched the writing style to one the listener had liked and dropped the
rejected subject; a user-authored prompt came back with an **empty patch** plus "the words are yours on
this prompt"; a `mix` retry dropped two production tags; and 40 excluded seeds still produced a fresh
one. Then 24 checks end to end through a second app backend (port 3091) pointed at that gate: the
verdict reached the loop and moved the profile while the market waited; the retry excluded the refused
seed, changed the tempo, explained itself, and two retries differed; a user-authored prompt was left
alone with `unactionable: language: ...`; a song with no stored request was refused with **409** rather
than queued; an unattributed verdict changed five things. Gates unchanged: `agent-spread` PASS, 40
validator checks, `subject-spread` PASS, 9 packs PASS, both typechecks clean. Live: `user_weights`
created in place, live aggregator restarted on the patched code with its `--schedule`, live endpoints
answering (`/api/users/:rater/profile`, `/api/next-take`), all four services up, both ledgers empty of
test data.

**Two test-harness lessons worth keeping.** `Copy-Item` is not a snapshot: with the live aggregator
running on a WAL, a file copy reads as `database disk image is malformed`, so both launchers now use
`VACUUM INTO`. And my shell's `PORT`/`DB_PATH` leaked into a backgrounded start and bound the run to a
scratch port and a scratch database; the live launcher now sets `PORT` and `DB_PATH` explicitly rather
than inheriting them. The live database was not touched by that, but it is the kind of mistake that
would have been invisible.

**Still to build after this:** the decay (17.8 item 4 - a key driven to the 0.25 floor stays there), the
rate limit, and Layer 2 (17.9). The next slice is the decay, because Layer U made the compounding
concrete: a listener can now drive their own profile to the floor in four clicks, and nothing walks it
back.


### 17.12 Decay: an opinion goes stale (2026-09-22)

Learning only accumulated in one direction. The 17.7 tests drove a key to the 0.25 floor in four hard
nos and left it there; Layer U then made the same true of a listener's own profile, which one person can
pin to the floor in four clicks. A weight is a summary of what *recent* listeners wanted, not a
permanent verdict on a genre, so this is the other half of the loop's memory.

**The rule** is a half-life, not a cliff: `(1 - rate)^weeks` of the distance from neutral is left after
a week, `WEIGHT_DECAY_PER_WEEK` default 0.02. Verified against the arithmetic rather than by eye - a key
at 0.25 is 0.2797 after two weeks, 0.3872 after ten and 0.7768 after sixty, and a favoured key at 3.0
comes down 2.9208 / 2.6342 / 1.5952 over the same spans, all matching the computed expectation to four
decimals.

**Both scopes.** `market_weights` and `user_weights`. There is no reading of "an opinion goes stale"
under which an individual's own profile should be the permanent one, and the failure mode is identical
in both.

**Two clocks, and that is the load-bearing detail.** `updated_at` stays "when was this last learned";
`decayed_at` is when a pass last touched it, and decay runs from whichever is later. Without the second
column every pass would reset the first, so either the decay could never accumulate or the ledger could
not say when a preference arrived. A weight that is not worth a write (shift below 0.0001) is skipped
*without* resetting its clock, so it keeps ageing - the second-pass test shows exactly that
(`decayed 0 of 8 (oldest untouched 2.0w)`).

**Where it runs**, all of them chosen because they are moments when the loop is about to read the
weights: server startup (a service off for a month must not come back holding last month's opinions), every
scheduled pass, and the head of a cycle. Plus `npm run decay` (`--dry-run`) and `POST /api/decay`
(`{ "dryRun": true }`), with `GET /api/decay` for the rule in force and the last pass. It is a function
of *time since the value last changed*, not of how often the pass runs, so a pass every six hours and a
pass once a month leave the same weights.

**Neutral is retired, not kept.** A weight that decays into a 0.005 tolerance band is deleted rather
than left as a 1.0 placeholder, so the tables stay a summary of current taste; the history stays in the
ledger, which nothing here touches. Writing the first version exposed a flaw worth recording: I had
purged anything *within* tolerance of neutral, so a preference of ±0.005 would have been deleted the
moment it arrived, losing it and reporting a "dropped back to neutral" that never happened. Now only
weights that were a real opinion (outside the band) and *decayed into* it are retired, and the test
covers both sides.

**Verified.** 18 checks through the CLI against a snapshot with dated rows (the arithmetic above, the
purge, a fresh key untouched, a neutral key untouched, a too-small preference kept, a future clock
skipped, a one-day-old key moving by a hair, both scopes, the `decayed_at` clock, an immediate second
pass being a no-op, and a key driven to the floor recovering to 0.5539 after 180 days without anyone
re-judging it); 10 checks over HTTP for the startup pass, `POST /api/decay` apply and dry run (a dry run
writes nothing, checked by reading the weights back), `GET /api/decay`, and the five-example cap. Gates
unchanged (`agent-spread` PASS, 40 validator checks, `subject-spread` PASS, 9 packs PASS) and all three
typechecks clean.

**Live.** The migration added `decayed_at` to both tables, and the first startup pass decayed **23 real
market weights** on the live database (0.5 weeks stale, largest shift 0.002) - small, as it should be
for three days, and visible in the log because the startup pass speaks only when it did something. The
live row shows both clocks doing their jobs: `updated_at 2026-09-19 04:37:52` (learned), `decayed_at
2026-09-22 16:00:04` (this pass). All four services up; every measurement above ran against a snapshot.

**A harness lesson, again.** I put "stop the service" and "start the service" in one batch and they ran
concurrently, so the stop killed the process that had just started - which looked exactly like a crash
with a clean log. The launcher now starts on its own, in a single command. Together with the WAL snapshot
and the leaked `PORT`/`DB_PATH` from 17.11, that is three ways this session's own tooling could have
produced a false result; all three are recorded because a verification method that can lie is worse than
none.

**Still to build after this:** the rate limit (a per-listener cap on verdicts, against griefing), and
Layer 2 (17.9). Decay has now closed the compounding gap that both Layer U and the agreement gate left
open; what remains is the editions loop, which is a project rather than a slice.


### 17.13 The cap on how much one listener can act with (2026-09-22)

The last item on the plan's safety list, and the one that closes the 17.10 caveat honestly: agreement is
counted in *people* while magnitude is counted in *votes*, so one listener judging hundreds of responses
adds unbounded magnitude once two others agree - and can drive their own profile to its floor unaided.
A hard-no button is also a way to grief.

**The rule.** `FEEDBACK_MAX_VERDICTS_PER_DAY` (default 100, over
`FEEDBACK_RATE_LIMIT_WINDOW_HOURS`, default 24; `0` means unlimited). A verdict that arrives after the
cap is **still recorded** - it is a fact about what someone heard, and the ledger is where facts live -
but it is *planned as nothing*, so no market votes are written and the listener's own profile does not
move. The response carries `rateLimited: true` with `{ limit, used, windowHours, resetsAt }`, and the
reason for reporting rather than merely logging is the same principle that has run through this whole
sequence: a verdict that quietly stops teaching is exactly the silence the loop exists to avoid.
`GET /api/users/:rater/profile` reports the same cap from the other side, because "how much of what this
person said is being acted on" is the same question.

**Three deliberate details.** The cap counts verdicts *sent*, not verdicts standing, so a flood cannot be
laundered through retraction - and the test proves it (retract one, then try again: still refused).
**Retractions are never capped**: refusing to let someone withdraw a judgement would be indefensible, and
a withdrawal can only reverse what that listener did. And the cap is per listener, so a flooded rater
leaves everyone else untouched (asserted, not assumed).

**In the app.** The verdict is still stored locally - it is the listener's, and it stands regardless of
what the loop does with it - and the UI says *saved, but not learned from yet* rather than letting the
button look like it taught something. New i18n key in all four languages. I also finally removed the
`loraManualPath` key (4 languages) that has been unused since the LoRA panel was rewritten - it was
flagged two turns ago and left, which is exactly how a dead string survives.

**Verified.** 11 checks on a throwaway snapshot with the cap set to 3 (port 3099): the first three act,
the rest are refused, a refused verdict is recorded in the ledger and moves **literally nothing**
(`profile: []`, `votes: 0`), the refusal reports `used`/`limit`/`resetsAt`, a retraction is never capped,
retracting does not buy another verdict, another listener is unaffected, and the profile reports the cap.
6 more through a second app backend (port 3091) pointed at that instance: all five verdicts return
**HTTP 200** with the verdict stored locally, the first three are learned from, the fourth and fifth are
`rateLimited`, the refusal is reported as a cap rather than a failure, and the ledger holds every one.
Gates unchanged (`agent-spread` PASS, 40 validator checks, `subject-spread` PASS, 9 packs PASS) and all
three typechecks clean.

**Two test-harness lessons, both about a cap that is per rater.** The aggregator test failed on its own
second run against the same instance - because the rater was a fixed name and the cap is real - so it now
takes a unique rater per run and repeats. The app test cannot do that (the rater is the app user's id),
so its precondition is a fresh aggregator instance, stated in the file rather than discovered by the next
person to run it. Neither failure was the code: both were tests asserting a state they had already used
up.

**Live.** Rate limit in force at 100/day (0 used), reported by the profile endpoint; decay still healthy
at 2%/week with its last pass recorded; all four services up.

**What is left: Layer 2 (17.9), and only Layer 2.** Every item on the plan's safety list is now built -
the gate, the listener's own layer, decay, and the cap - and the corpus its editions loop needs already
exists (prompt, response, verdict, reasons and edition per song). What remains is a project rather than a
slice: an editions registry, a training orchestrator, an adoption gate measured on held-out preferences,
and a validation protocol that can survive the two failure modes named in 17.9 (training on your own liked
output collapses; a loop that learns only from what people rejected will learn to avoid everything). It
also needs GPU time and a decision about what "better" means before it can be adopted automatically, so
it is deliberately not something to slip in at the end of a session.


### 17.14 Layer 2 begun: the corpus, the gate and the registry (2026-09-23)

17.9 designed the soft-tuning loop and named the two things that are not optional in it. This slice builds
the part that *decides*, in a way that can be verified without a GPU - which is the only order in which it
should have been built, because the decisions are what go wrong silently.

**Three modules, three responsibilities, each refusing something.**

| module | owns | refuses |
|---|---|---|
| `design/editionCorpus.ts` | the training mix | to train on a mix that is thin, anchor-less, or mostly negatives |
| `loops/editionGate.ts` | the adoption decision | to adopt on a tie, a proxy metric, or too little evidence |
| `loops/editions.ts` | the registry | two incumbents, or an adoption with no evaluation behind it |

**The corpus and its guards.** Training on your own liked output collapses, so only one of the three parts of
the mix is feedback: preference pairs from the ledger, **anchors** (unjudged designs carrying the
chart-derived and curated material, minimum `EDITION_MIN_ANCHORS` or the corpus refuses), and a
`EDITION_MAX_NEGATIVES_PER_POSITIVE` cap because a model taught only avoidance learns to avoid everything.
Dislikes are ranked by how much the listener had to say, so the negatives that survive teach something
specific. The split is by **prompt**, not by response - a response-level split would hold out prompts the
candidate was trained on and measure memorisation - and the prompt's hash decides which side it falls on, so
a held-out pair cannot move as new feedback arrives and leak into the next run. The corpus is deterministic
given the ledger, so the `dataset_hash` an edition records is a real promise about its mix.

**The gate.** A pair counts for a model when it scores the *worst* liked response above the *best* disliked
one - strict preference, not average loudness. Five refusals, one per way this goes wrong: too little
evidence (`EDITION_MIN_HELD_OUT_PAIRS`), no improvement (a tie is a rejection), a lucky pair (accuracy
required, not merely "better on the day"), a broken candidate that wins the metric (the existing quality
gates are a precondition), and tuning for ever (halt after `EDITION_MAX_NO_WIN_TRIALS`). The scorer is
**injected**, which is what let the whole protocol be tested against a known-good and a known-bad model
before any GPU time was spent - and is also what keeps a decision module from containing an audio pipeline.

**The registry.** `editions` records the ordinal, the base it tuned from, the corpus hash and manifest, the
hyperparameters, the adapter path, and the evaluation that authorised it. Two invariants are enforced by the
schema and the code rather than by convention: **at most one adopted edition** (a partial unique index - two
incumbents would make "the incumbent" ambiguous), and **adoption is authorised by the decision, not by the
presence of a blob** - `adoptEdition` refuses an evaluation whose decision is not `adopt`. The second
invariant came out of the test run: my first version accepted any non-empty evaluation, and the test adopted
a candidate whose own evaluation said `reject`. That is exactly the "silent adoption" this loop must not
have, and writing the test before trusting the code is what surfaced it.

**Provenance, both ways.** `conceptToBody` now sends the ordinal in force with every render, the app stores
it on the song, and the app's verdict report carries it (plus `promptId`, so the corpus can hold out whole
prompts) back into `feedback.edition` / `feedback.prompt_id`. That closes the loop 17.9 needed: feedback on
edition N is the training signal for N+1.


**Verified.** 39 checks against a snapshot, all offline. Registry: the base model is the incumbent before
any adoption; a candidate is recorded but not in force; adoption without an evaluation is refused; adoption
*on a rejecting evaluation* is refused; an adopted edition becomes the ordinal responses record and its
adapter becomes the next candidate's `resumeCheckpoint`; a rejection is kept as evidence and leaves the
incumbent alone; a retired edition cannot be re-adopted; the failure count resets on adoption and counts
towards the stop rule. Corpus: the split accounts for every judged response exactly once; every held-out
pair has both sides; the negatives cap holds; the hash is stable across builds; a thin corpus reports three
named blockers rather than training. Gate: a better model is adopted, a worse one is rejected with reasons,
a tie is rejected as no improvement, too little evidence refuses to judge, a candidate that wins the metric
but fails the quality gates is rejected, and repeated failure halts. Gates unchanged (`agent-spread` PASS,
40 validator checks, `subject-spread` PASS, 4 packs PASS) and all three typechecks clean.

**Live.** The migration added `editions` plus `feedback.edition` / `feedback.prompt_id` in place, and the
running service reports its own state: **in force: the base model**, 0 editions recorded, 0/3 toward the
stop rule - and the live corpus is **blocked**, honestly, on 3 judged responses (needing 8 samples and 5
held-out pairs) with 8 anchors available. Layer 2 is therefore *observable but inert* on this installation,
which is the correct state for a ledger this young: the endpoints, the guards and the gate all work, and
none of them will train on three clicks. Those three verdicts are real app verdicts (1 like, 2 dislikes,
one on a `jp` song) and were left exactly as they were - a verdict is a fact about what someone heard.

**A test-authoring trap worth recording.** The fixture's fake model matched sample sides with
`includes('liked')` - and `p0-disliked-1` *contains* "liked", so both sides of every pair scored the same and
a perfect candidate looked like a perfect tie. Rewritten as `endsWith('liked')`, it was **still** true for
"disliked" (which ends in "liked"), and the same silent tie came back. Only matching with a leading
separator (`-liked`) is safe. Nothing in the product code does this kind of matching - it was purely my
fixture - but it is why the first two runs of the gate tests "failed" while the gate was right.

**What is left of Layer 2, precisely.** The **executor**: build the dataset JSON in the Gradio shape the
app's training path expects, call `POST /api/training/preprocess` → `/start` (with `resumeCheckpoint` taken
from the incumbent's adapter) → `/export`, register the result as a candidate, render the held-out prompts
through both editions, and score them - the real `EditionScorer` that plugs into the gate that now exists.
The app already has every mechanical piece, so this is glue plus a measurement protocol rather than new
machinery, and it is the first step that needs the GPU and a decision about what the score should be.


### 17.15 The score is a person: the listening test (2026-09-23)

17.14 left one open question - what should the score be? - and the answer this system already had written
down settled it. The README has said since 17.2 that **only human judgement moves anything, because a model
grading its own output is not evidence**. An edition is a model, so the same rule applies to adopting one:
no loss curve, no embedding distance, no engine quality signal. The held-out prompts are rendered under both
editions, the two renders are presented unlabelled, and the listener says which they would rather have. The
loop optimises a judgement it cannot produce itself.

**What that cost, and what it bought.** A render per held-out prompt per edition, plus someone listening -
expensive, and the reason this is a project rather than a script. What it bought is in 17.14's own terms: the
scorer is injected, so the protocol was verified offline against a known-good and a known-bad model; and the
number the loop optimises is not one the loop can move.

**How a listening test becomes the gate's inputs.** The liked render and the disliked render on a prompt are
the pair; each carries the edition that produced it; and the scorer reduces to "an edition scores 1 on its
own render and 0 on the other's" - so the gate that already existed (`worst liked > best disliked`) becomes
exactly "did the listener prefer the candidate's render". A prompt where both renders came from one edition
is *ambiguous*: the listener had a preference, but not between the two editions, so it is counted and set
aside rather than quietly weakening the result. Prompts rendered twice but judged once are counted as
*pending*, which is what stops "no decision yet" looking like "nothing to do".

**Three bugs, all found by writing the test first, and all producing wrong decisions rather than errors:**

1. **The gate compared an ordinal with a UUID.** A song records the edition *ordinal* (stable, readable, and
   what `conceptToBody` sends); the registry works in *ids*. The first scorer compared `'0'` with a
   candidate's UUID, so nothing ever matched, every pair tied, and a candidate the listener clearly
   preferred was refused as "no improvement". `editionIdForOrdinal()` is the join, with `base` as the
   pseudo-id for renders made with no adapter - and the base model is now a *real* comparison target rather
   than a missing incumbent.
2. **A candidate was judged on history.** The evidence accumulates in the ledger, so a new candidate was
   scored on pairs from *earlier* comparisons: where the incumbent had beaten some other edition, that read
   as a loss for a candidate that was never involved. Round three's decision cited 9 decisive pairs when it
   had been listened to on 5. The evaluate endpoint now keeps only the pairs comparing *these two editions*
   and reports the rest as `setAside`.
3. **Ordinals collided.** `createCandidate` took the ordinal from the *incumbent* (`adopted.ordinal + 1`),
   so a rejected candidate and the next one shared an ordinal - and since a song records its ordinal as
   provenance, that makes the provenance ambiguous. It now comes from the registry (`MAX(ordinal) + 1`).

**The guard that keeps the test from eating itself.** Renders made for a listening test produce verdicts like
any others, and if those were training material the next candidate would be trained on the held-out set and
the gate would be measuring memorisation of its own test. So they are marked: `renderRole` on the job, `role`
on the verdict (`feedback.role`, default `training`), and the corpus excludes `evaluation` rows and reports
the count as `evaluationExcluded`. The app passes the role through from the render's own params, so the
harness cannot forget.


**Verified.** 27 checks through the API against a snapshot (port 3099), all driven by a *scripted* listener
- the fixture is given the two renders and likes the better one, so the decision is known before the gate
runs. A candidate can be registered; the plan names the prompts and the two failure points; a dry run judges
without touching the registry; the gate **adopts** a candidate the listener preferred four times out of five,
and the registry records exactly one adopted edition with its evidence; a second candidate tunes from the
adopted edition; a candidate the listener did not prefer is **rejected** and the incumbent stays in force; a
preferred candidate that fails the quality gates is **still refused**, and its reasons cite *only* the gates -
which is the cleanest possible demonstration that the decision was about the comparison and not about
missing evidence; every edition has its own ordinal; and the ten listening verdicts are excluded from the
next corpus with none of them in it. Gates unchanged (`agent-spread` PASS, 40 validator checks,
`subject-spread` PASS) and all three typechecks clean.

**Live.** `feedback.role` migrated in place, and the running service reports **in force: the base model**,
0 editions recorded, listening test empty - with `npm run edition-evidence` printing the plan: render each
prompt under the base model and under the candidate, present them unlabelled, judge, then evaluate. The
loop's *decision* half is complete and observable; the only thing between it and a first real edition is the
executor.

**What is left, precisely.** The app-side executor: build the Gradio dataset JSON from the corpus (the app
owns the audio paths and the request bodies that the corpus references only by song id), call `preprocess` →
`start` with `resumeCheckpoint` from the incumbent's adapter → `export`, register the candidate, then render
the held-out prompts under both editions with `renderRole: 'evaluation'` and put them in front of a listener.
It needs the GPU, and it is glue over machinery the app already has.


### 17.16 The measured judge, and why not the loss curve (2026-09-23)

Asked to choose between two proxies - the engine's own step/loss signals on a fixed seed, or a re-render
compared to the liked responses by a distance - the second is the one to build, and the reasoning is worth
keeping because the first option *looks* cheaper and is structurally broken.

**Why not the loss curve.** Comparing step/loss between an incumbent and a candidate on the same corpus is
biased by construction: the candidate was trained on the very material it is being measured against, so the
newest edition almost always wins - and a gate that always says yes is not a gate. Worse, lower loss is
*precisely* the objective of the collapse failure mode 17.9 named: it rewards fitting your own liked output
more closely. Loss measures fit; adoption is a question about preference. (The engine also exposes no
per-sample loss or embedding endpoint, so it would have meant new engine work on top of a flawed premise.)

**Why the distance works.** It keeps the *shape* of the listening test - two renders of one held-out prompt,
and the listener's own liked material as the reference - and replaces only the ear. Because both forms arrive
as a verdict on each render, everything downstream is unchanged: the same evidence, pairs, gate,
corpus-exclusion and provenance. A person can override any single judgement by hand, and a decision can
always say how it was reached.

**What it is.** Band energies from a Goertzel filter bank (no hand-written FFT: same answer for band energies,
fewer moving parts), each frame normalised to a *distribution over bands*, the frame's tilt removed, plus
brightness and a zero-crossing rate, summarised as mean and spread over the track, L2-normalised, and
compared by cosine similarity to the mean of the liked material. Decoding is handed to ffmpeg, which is a real
dependency and is reported as one: a missing decoder means no measurement, not a zero distance.

**Three things the tests caught, all of which would have let the loop be gamed or misled.**

1. **The first fingerprint was level-sensitive.** It used `log1p(energy)`, and the same material at a quarter
   of the volume scored 0.94 against itself - so a candidate could have won a comparison by being mastered
   louder rather than by being closer to what the listener liked. The fix is exact rather than approximate:
   divide each frame by its total energy *first* (every band scales by the same factor, so the level is gone),
   then take the log. Verified: 1.0000 at any level.
2. **It was too blunt to decide anything.** With the level fixed, a tone and pink noise still scored 0.95 and
   two different real songs scored 0.99, because every track is louder in the low bands than the high ones and
   that shared slope dominated the vector. Removing each frame's tilt as well took tone-versus-noise to 0.78
   and left the slope where it belongs, in the brightness feature.
3. **A failure must not read as a tie.** A comparison whose file cannot be read is *reported and skipped*, not
   counted as a tie: a tie is a measurement that found nothing, a failure is no measurement at all, and
   turning the second into the first would quietly weaken every evaluation.

**Its resolution, measured rather than assumed.** The same audio against itself scores **1.0000**; four
different real songs from this machine's renders score **0.9585, 0.9896, 0.9797, 0.9737** - a worst-case gap
of **0.0104** between "this is the same material" and "this is a different song". The tie margin is 0.005,
half of that, and it is a *policy* rather than a noise floor: the measurement is deterministic, so a tighter
margin would decide more pairs on finer differences. That narrowness is the honest limitation - the judge can
tell *this render* from *another song*, not a good take from a mediocre one of the same prompt - which is why
the listening test stays available, the gate still demands a win rate and the quality gates, and the
provenance is recorded. It is a hypothesis to be validated (run both on the same prompts and compare their
agreements), not a replacement for listening.

**Verified.** 14 checks on the fingerprint and the comparison, using real renders where possible and
synthetic signals for what one file cannot demonstrate: a file matches itself exactly; two renderings of one
tone match; the same material at a different level matches *exactly*; a low tone is not a high tone; a tone is
not noise; a static render differs from a moving one; the closer render wins and swapping them swaps the
winner; two indistinguishable renders are a tie rather than a coin toss; a reference of several liked takes is
itself a fingerprint; an unreadable file says so rather than scoring zero; and real renders fingerprint and
stay distinguishable. Then 13 checks through the running stack, standing in for the harness with real files:
the judge reports every comparison, finds the closer render each time, reports both verdicts per prompt with
the similarities behind them, the loop sees five decided pairs, the gate **adopts** from them, every verdict is
recorded as `edition-proxy`, an identical pair is a tie and is *not* reported, a broken comparison is reported
rather than tied, and the route refuses an empty list and an incomplete comparison while naming the prompt.

**Still to build: the training run and the render harness.** `preprocess` → `start` (with `resumeCheckpoint`
from the incumbent's adapter) → `export`, plus the glue that turns a corpus into the Gradio dataset the app's
training path expects, and the harness that renders the evaluation plan under both editions. Every mechanical
piece exists; what is left is joining them, and it needs the GPU plus a ledger with enough preference evidence
to pass the corpus guards (this install has 3 verdicts and no judged pairs yet).

### 17.17 Using the batch we already have: the corpus could not see it (2026-09-23)

"You have my sample data as the batch" turned out to be two corrections and a measurement, not a training run.

**1. Half a rule was wrong in the corpus.** A held-out pair required a prompt with **both** a like and a
dislike. That was a leftover from the older formulation of the evaluation, and it is wrong for the judge that
was actually built: the judge renders the prompt under both editions and asks which render is closer to what
the listener *liked* there. The reference it needs is the like; a pre-existing dislike adds nothing it can use.
The effect of the old rule was brutal on real data - eleven likes across eleven prompts and two dislikes
elsewhere produced **zero** pairs, so a corpus with plenty of material reported itself empty. A held-out prompt
now needs a liked response, and held-out is still whole-prompt, so the prompt a candidate is judged on is one
it never trained on.

**2. Ten of eleven likes never reached the loop.** The app has two verdict paths. The newer
`POST /api/songs/:id/feedback` reports to the aggregator; the older `POST /api/songs/:id/like` wrote
`liked_songs`, adjusted `like_count`, cleared any hard no - and **stopped**. So a like arriving on the older
route was invisible to the ledger, to the listener's profile and to the corpus, while the app looked fully
liked. Both routes now build the report through one shared service (`services/preference.ts`), which is the
only way the two can be guaranteed to mean the same thing. Ten of the eleven existing likes took that path.

**3. The app could not tell "written" from "already known", which made my own backfill lie.** The aggregator's
answer carries `replayed`/`recorded`/`replaced`/`note`/`votes`, but the app's `reportPreference` mapped a fixed
set of fields and dropped them - so a backfill that had written 10 rows printed "recorded 11", and a second run
of it printed "recorded 11" again. The ledger was right; the report was not. The mapping now carries them, and
the re-run says `recorded 0 | already known 11`.

**4. Verdict identity, which an agent will depend on.** `POST /api/feedback` used to insert unconditionally, so
the same report sent twice counted twice toward agreement and took two steps in the caller's profile. A retrying
client - an agent especially - would have inflated its own influence. Now:

| case | behaviour |
|---|---|
| the same verdict again from the same rater on the same response | answered `replayed: true`, writes nothing, moves nothing |
| a **different** verdict | replaces it: the old row is withdrawn, its votes released or reversed, its profile steps undone, and `replaced` reports what it undid |
| over the daily cap while changing an earlier verdict | **refused**, and the earlier verdict is left standing - withdrawing a preference in favour of a judgement that acts on nothing would take away and give back none |
| retracting (`none`) without a market | now works: the prior verdict is found by (rater, response) and the market is read off the row being retracted, not off the request |

That last one needed `feedback.plan`: the steps a verdict decided on are stored with it, because the market's
votes are in `feedback_votes` but the listener's own profile has no equivalent table - so a retraction used to
undo the market's share and leave the person's share standing, which is the half they notice.

**5. A rating of the loop's own render is a judgement too.** The ledger covers songs a listener was given;
`ratings` covers the renders the loop made for itself. Five ratings existed across three distinct runs (a 0.85,
a 0.35, and one run rated three times at 0.7 → 0.8 → 0.9), and none of it was visible to the corpus. The corpus
now reads both, with three rules so a rating means what a verdict means: an explicit `like`/`dislike` wins;
otherwise the loop's own bars apply (`championThreshold` is a positive, below `viableThreshold` a negative) and
the **band between them is ambiguous and skipped** rather than guessed at; and only the **latest** rating of a
run counts. A rated render's prompt key is its **concept**, so whole designs are held out, never single renders
of a design that also appears in training. `counts.songs` / `counts.runs` / `counts.withAudio` report the mix,
because a model trained only on the app's output is a different model from one trained only on the loop's.

**Where the batch actually stands.** 11 likes replayed into the ledger (`npm run likes:backfill`, idempotent by
construction through rule 4 above - the aggregator answers a repeated verdict without writing), which with the
existing verdicts and the three rated runs gives:

| | value |
|---|---|
| judged material | **16** (13 listener songs + 3 rated renders) |
| likes / dislikes | 13 / 3 |
| training samples after the split and the 2:1 cap | 12 |
| anchors from unjudged designs | 8 (guard: 8) |
| **held-out pairs with a liked reference** | **4** (guard: 5) |
| blockers | one: `only 4 held-out prompt(s) with a liked reference; 5 are needed` |

So the loop is **one pair short** of being trainable, and that is the honest number rather than a reason to
lower the bar: with `EDITION_HELD_OUT_SHARE=0.3` roughly three judged prompts in ten fall in the held-out
bucket, so one more pair is about four more liked prompts. The guards stay as they are - five comparisons is
already a coarse basis for adopting a model.

**Two findings for the record.**

- **The 11 backfilled likes teach the listener's profile only.** None of those songs records a market (they were
  made straight from the Create tab), so they move `user_weights` and cast no market votes. On this install the
  operator is also the only rater, so the agreement gate holds everything at `pending` until a second person
  judges anything, or `FEEDBACK_MIN_USERS=1` is set deliberately. Profile after the replay: `bpm:fast` 1.315,
  `language:en` 1.36, `bpm:midtempo` 1.21.
- **Rated runs do not join to app songs.** `runs.pipeline_job_id` matches `songs.prompt_id` for only 2 songs, and
  the audio lives in different stores (`data/audio/<market>/<run>_0.mp3` for the loop, per-user storage for the
  app). A rated render is therefore training material in its own right, with its own path, and the executor - not
  the corpus - resolves them. Only one of the three rated runs still has `local_audio`, which is why
  `counts.withAudio` is 1.

**Verified.** 18 checks over HTTP against a snapshot of the live database on a scratch instance (min 3 raters):
a verdict is recorded; the same verdict again is answered as a replay with no votes and no profile movement and
stays **one row**; a different verdict replaces it and exactly one verdict stands afterwards; a market-less like
is recorded, teaches the profile and reaches no market; it can be retracted without a market, its profile steps
are undone, and no verdict stands afterwards; a verdict within the cap is not rate-limited; the corpus is
reachable and no blocker asks for a like *and* a dislike. Then the live corpus figures above, and the gates
unchanged (`agent-spread` PASS, `lyric-validate-suite` 40/40, `subject-spread` PASS, both typechecks clean).

**Harness notes, again.** `Start-Process` does not quote arguments, so this repo's space in
`g:\Program Prototype` split the script path in half for node - absolute paths must be avoided in favour of
`-WorkingDirectory` with relative arguments. And a scratch instance bound to port 3099 was left listening from
an earlier check; the restart filter had to match `serve` as well as the repo path to catch it.

### 17.18 An agent as a rater, and trust as a flag (2026-09-23)

Shugocore will interact with this system directly, so the loop needs a surface an autonomous caller can use
safely. Decided: **the agent acts on its own profile at once and moves a market's weights only when the user
flips a flag** - which is what was built, with the flag off by default.

**One write path, deliberately.** The agent is not given its own endpoint to write judgements. It uses
`POST /api/feedback`, the same one a listener's click uses, because two write paths for "this response is
wrong" would eventually mean two meanings - and the one that drifts would be the machine's. What an agent
gets instead is *discovery*: `GET /api/agent` returns the contract as data (endpoints with the fields that
matter, what each reply field means, what an agent cannot do, and the configuration in force), and `GET
/api/agent/state?market=&rater=` answers a whole session's orientation in one round trip - edition in force
and how close the stop rule is, the corpus and its blockers, the market's weight notes, the rater's own
profile and cap, and what would plausibly come next *derived from that state* rather than from a script.

**Trust is a flag, not an identity.** `FEEDBACK_TRUSTED_RATERS` (comma-separated, empty by default) names
raters whose own verdicts move market weights without waiting for `FEEDBACK_MIN_USERS` distinct people to
agree. Empty means an agent behaves exactly like any other listener: its verdicts teach its own profile
immediately and are held as pending votes. Removing a name restores the ordinary gate with no other change,
and since every vote records its rater, a market's weights can always be explained by who asked.

`promoteRaterVotes` is deliberately narrow - it is an exemption from the agreement gate and nothing else:

| still enforced for a trusted rater | why |
|---|---|
| only **its own** votes move (the query is scoped by rater) | otherwise a trusted rater would carry other people's pending votes across the threshold |
| `FEEDBACK_PROMOTE=false` writes nothing | a shadow deployment stays a shadow deployment |
| the daily cap, checked before there is a plan to vote on | a flood cannot act, trusted or not |
| the window | an agent's stale verdict does not act months later |
| replay and replacement rules | a retried report is still not a second opinion |

**Verified - 12 checks in each of three configurations**, on a snapshot of the live database on a scratch
instance, with the test's expectations taken from the *server's* answer rather than from the shell (which is
how the first run "failed" while the service was behaving correctly):

| configuration | result |
|---|---|
| trust list empty | profile moves at once; `votes=3 applied=[]`; market untouched; pending reads **2 of 3 raters** |
| `agent:shugocore` trusted, promotion on | `appliedByTrust` lists the three tag keys and the weight actually changes |
| `agent:shugocore` trusted, `FEEDBACK_PROMOTE=false` | trust does **not** bypass shadow mode: `appliedByTrust=[]`, weight untouched |

Also checked: the contract is served and names **exactly one** write path; the contract reports the rater's
trust as a boolean and says what it changes; the state read arrives in one call and names the blocker.

**One real bug found by running it.** `GET /api/agent/state` threw a 500 (and Express answered with HTML,
which the test caught as "not valid JSON") because `describeEdition(null)` throws when no edition has been
adopted - the base model is a *state*, and `describeEdition` expects a row. The existing `/api/editions` route
guards for this; the new one did not. Now it says `the base model (no edition adopted yet)`.

**Two test-harness facts worth keeping**, since both made a correct service look broken:

- `planFeedback` derives production tags from the **style string**, not from a `tags` field, and the tag
  vocabulary is filtered **by genre** - a fixture saying `pop` with tags in the style produces an empty plan
  and looks like a product failure until you look. `country` has the words; `pop` does not.
- a test that decides its own branch from its own environment will assert the wrong thing the moment the
  service disagrees with it. Read the authority.

**Live now.** `GET /api/agent` and `/api/agent/state` answer on 3002, corpus blocked at 4 of 5 held-out
pairs, base model in force, stop rule 0/3.

**Flipping it is a request, not a redeploy** (17.20). `FEEDBACK_TRUSTED_RATERS` is the *seed*; the switch is
`trusted_raters`, written at startup from that variable and thereafter by
`POST /api/agent/trust { rater, enabled, note? }`. Trust was turned **on** for `agent:shugocore` through that
endpoint (`source: api`, with a note and a timestamp), and turning it off is the same call with
`enabled: false`.

### 17.19 The executor: a dataset the engine could actually read (2026-09-23)

The executor is built and proved end to end **up to the training call**: it turned the live corpus into a
dataset, the engine loaded it, and preprocessing produced **10 tensors from 10 samples in 86 seconds**.

**What it does.** `GET /api/editions/execute/plan` (read-only) resolves every corpus sample to a file,
reports the ones it cannot reach and every guard that would refuse a run. `POST /api/editions/execute` writes
the dataset in the engine's sample shape, asks `/v1/dataset/load` and `/v1/dataset/preprocess`, and then
**stops** - naming the `/api/training/start` call to make with the tensor directory and checkpoint it chose,
because training occupies the engine for the whole epoch count and this engine is single-instance. Training
is never started by an automated path.

**Guard refusals, with one deliberate escape hatch.** The corpus's own blockers are never overridable: they
are the loop's judgement about whether a run is warranted. Missing audio is different in kind - the corpus is
sound, the file is gone - so the default refuses and `allowPartial: true` proceeds, with the dropped samples
recorded *in the dataset* (`dropped_samples`, with the reason) so an adapter stays traceable to what it
actually saw rather than to what the corpus intended.

**Three findings, each of which would have produced a silent failure.**

1. **The engine was handed a relative path, and preprocessing produced zero tensors.** The app's `.env` says
   `AUDIO_DIR=./public/audio`, which is valid from the server's working directory and meaningless from the
   engine's - so every sample failed to decode (`load_audio_stereo` in the engine log) and the response said
   `tensors: 0` while everything else looked like success. The fix is not a `path.resolve`: the *provider*
   is now asked for the path (`StorageProvider.localPath`), because the provider is what actually decides
   where objects live (`__dirname`-based and absolute), while configuration is not. The two agreed only by
   coincidence, and only while the server happened to be started from its own directory.
2. **`songs` has no `is_instrumental` column.** The first real run failed with `no such column` - an
   assumption about a schema, not a fact about it. Instrumental-ness is now read from the lyrics themselves,
   which is where the app records it.
3. **A "read-only" plan was writing files.** The first version of `planExecution` copied each song into the
   uploads directory, so the check called "and it writes nothing" was only asserting the *response*, not the
   effect. With the provider fix, local audio is used in place and no copy happens at all - the plan is now
   genuinely read-only, which is what its documentation claimed from the start.

**Verified.** 10 checks through the running app on the real corpus: the plan is served, reports `trainable`,
names both blockers, resolves the samples it can and says why it cannot resolve the rest (two rated renders
whose `local_audio` was never recorded), and refuses a run *before writing anything* (`datasetPath: ''`). Then
the real path through a scratch app pointed at a scratch aggregator whose pair guard was relaxed
(`EDITION_MIN_HELD_OUT_PAIRS=1`): dataset written with 10 samples, engine loaded it, **10 tensors** produced,
stopped before training. On the real corpus the guards refuse - which is correct, and is why the end-to-end
run needed a relaxed guard to exercise.

**Left behind, deliberately, and where.** The run's artifacts are still on disk:
`ACE-Step-1.5/datasets/edition-1-5299a716.json` (with its `dropped_samples`), and
`edition-1-5299a716_tensors/` (11 files). The engine's in-memory dataset builder now points at that dataset,
because `/v1/dataset/load` is not reversible - worth knowing before opening the Gradio training tab. Nothing
in the app's or the aggregator's live database was changed by the exercise.

### 17.20 The trust flipper: the flag as a row, not a launch argument (2026-09-23)

Asked to "put the trust flag flipper on", the honest reading is both halves: build the flipper, and turn it on
for the agent. So trust is no longer read from the environment on every request.

**Why a table.** `FEEDBACK_TRUSTED_RATERS` is the *seed*, written into `trusted_raters` at startup (additively:
a name already recorded keeps its original source and timestamp). Every decision - the verdict route, the
contract, the state read - consults the table. That matters because of what this flag does: it exempts one
rater from the agreement gate, and "the agent could move a market only while the service happened to be
launched with the right variable" is not a property anyone can reason about. An entry records `source` (`env`
or `api`) and `created_at`, so "why is this market moving on one agent's word?" has an answer, and deleting
the row returns that rater to the ordinary gate with nothing else changed.

**The flipper.** `POST /api/agent/trust { rater, enabled, note? }` - idempotent in both directions, so a
caller can set the state it wants without reading first, and `changed: false` is not an error. It answers with
the effective list and what the change means. `GET /api/agent/trust` lists who is trusted and where each
entry came from. Both are described in the contract, and `POST /api/agent/trust` is the one endpoint marked
`writes: 'authority'` - distinct from `POST /api/feedback`, which is the one endpoint that writes a
*judgement*, because those two invariants are worth being able to see at a glance.

**Verified - 13 checks** on a scratch instance over a snapshot of the live database (so no fabricated verdict
touched real data): before the flip the verdict teaches the agent's own profile and its votes read *1 of 3
raters* with no market movement; the flip reports the change and the contract agrees for that rater; the next
verdict moves the market on its own (`tag:country -> 0.8` etc.); flipping it back stops that, and the contract
says so again; a second identical flip is answered `changed: false` rather than as an error; a flip with no
rater, and a flip with no `enabled`, are both refused with the reason. The snapshot also carried the live entry
across, which is the restart behaviour: trust survives a restart because it is a row.

**On.** `agent:shugocore` is trusted now (`source: api`, "Shugocore agent, enabled by the operator"), so its
verdicts move market weights immediately while everyone else still needs `FEEDBACK_MIN_USERS` distinct raters.

### 17.21 Where the code lives: Core.fm is ours, ace-step is only upstream (2026-09-23)

A correction worth writing down, because it changes what "push" means: **our repository is
`https://github.com/SamurAI-Official/Core.fm`**, and `ace-step` is the project the engine was forked from -
never a push target.

**Before.** The app and the loop had it right (`origin` -> Core.fm, and the app also carries `upstream` ->
its own fork source), but the **engine had no remote to ours at all**: its `origin` pointed at
`git@github.com:ace-step/ACE-Step-1.5.git`, so its six Core.fm patches existed only on this disk, and a push
would have failed (that remote is unreachable - no SSH key or `known_hosts` entry here) or, worse, would have
sent our patches to somebody else's project.

**After.** The engine repo now follows the same convention as the app:

| remote | url | role |
|---|---|---|
| `origin` | `https://github.com/SamurAI-Official/Core.fm` | ours - **the push target** |
| `upstream` | `git@github.com:ace-step/ACE-Step-1.5.git` | the fork source, read-only in practice |

and Core.fm now holds all three histories:

| branch | tip | what it is |
|---|---|---|
| `main` | `8ef165f` | the app, with the loop vendored as a subtree |
| `signal-aggregator` | `7c7ad89` | the loop's own history |
| `ace-step-1.5-patches` | `ddb1d9f` | the engine with our patches on top of upstream |

**Two things had to be fixed before the engine branch was publishable.**

1. **The working tree was on a detached HEAD** (`83544a8`, exactly the tip of `corefm-local-patches`) - a
   state where a commit is one `checkout` away from being unreachable. The branch is checked out now, and
   tracks `origin/ace-step-1.5-patches`.
2. **`loras/` was not ignored** (only `datasets/` was), so anything that added the tree would have carried
   adapter weights into Core.fm. `.gitignore` now excludes `loras/` and `lora_output/` - machine-local,
   reproducible from their sources (the LoRA panel re-downloads a published adapter; an edition is rebuilt
   from its corpus hash) - and the Core.fm launcher `start-corefm-engine.bat` is committed instead, because
   it documents *why* this install must run with `--use_flash_attention false` and `--quantization none`,
   which is what the patch set exists to carry.

**The engine patch set** (`corefm-local-patches`, 6 commits on top of upstream): training-dataset routes
registered for the Gradio app, `--quantization none` accepted so adapters can load, a loaded adapter made
re-enableable (and reporting when it cannot), the base decoder restored on unload *or an error reported*
instead of a false success, the LoRA state exposed as a named `lora_status` endpoint, and now the launcher
with the ignore rules.

**A gotcha that will bite the next push from that repo.** The engine's **repo-local** git config carries
`http.proxy`/`https.proxy = http://127.0.0.1:7897` - a local proxy client that is not always running - so
`git push` from there fails with `Failed to connect to 127.0.0.1 port 7897` while the app repo (no proxy
config) pushes normally. The push above used `git -c http.proxy= -c https.proxy= push ...` to override it for
one command. To make it permanent, either drop the two stale lines
(`git config --local --unset http.proxy && git config --local --unset https.proxy`) or set them in the
environment only when the proxy is actually up - that is a network decision, so it was left alone.

**Still unversioned.** `INSTALL-NOTES.md` (this file) is tracked by no repository: it lives at the workspace
root, which is not a git repo. Every number and finding above is recorded only on this disk.

