# Signal Aggregator

Country-level music trend aggregation, market briefs, market-specific song design
and a generate → test → learn loop, driven by the local ACE-Step pipeline.

It answers four questions in a repeatable cycle:

1. **What is popular where?** — per-nation charts, normalized into one genre
   taxonomy, with tempo, length, recurring themes and momentum (what is *rising*,
   not just what is big).
2. **What should we make for that market?** — a design brief per market: genre
   mix, tempo target, key, structure, length, local production colour and vocal
   language.
3. **Did it work?** — every rendered song is scored on how well it matches the
   market's evidence, how fresh it is against the current chart, and — once you
   rate it — how the market actually responded.
4. **What do we change next time?** — human ratings adjust per-market weights so
   the next cycle leans into what worked.

## How it fits together

```
Apple Music charts (per country) ─┐
Deezer charts (worldwide + genre) ─┤→ signals → market briefs → song designs
iTunes lookup (genre/duration)   ─┘                              │
                                                                 ▼
                        ace-step-ui backend (:3001) → ACE-Step engine (:8001)
                                                                 │
                                     rendered audio → scores → human ratings
                                                                 │
                                              market weights → next cycle
```

The aggregator never talks to ACE-Step directly: it goes through the running
`ace-step-ui` backend, exactly like the UI does (same auth, same generation and
status endpoints, same `/audio` delivery).

## Driving it from the ACE-Step UI

The aggregator is integrated into the `ace-step-ui` frontend as a **Trends** view
(sidebar → Trends), so the whole loop can be triggered and augmented by hand:

- **Run the loop** — market chips, "designs per market", "render N songs",
  reuse-signals and instrumental toggles, then `Collect signals` / `Design songs` /
  `Run full cycle`. A pipeline status pill shows whether ACE-Step is reachable.
- **Market cards** — genre mix, tempo (with its basis), churn/baseline, chart
  leaders, recurring themes, confidence, and design/run/rating counts.
- **Augment a design** — open any design and edit title, style prompt, BPM, key,
  meter, duration, vocal language, instrumental flag and lyrics, then `Save changes`
  or `Save & render`. Edits are persisted and sent with the render request.
- **Listen and judge** — every rendered song has an inline player; the 0.2–1.0
  rating strip re-scores the run immediately and shows the market weight deltas it
  applied. The score breakdown (per-component scores and reasons) is expandable.
- **Full report** — the plain-text market report in a modal.

How the wiring works:

```
browser ──/aggregator/*──► Vite dev proxy ──► aggregator :3002 ──► ace-step-ui :3001 ─► ACE-Step :8001
```

The frontend only ever uses relative URLs (`services/aggregator.ts`), so LAN access
works exactly like the rest of the app. The UI-side surface added:

| File | Purpose |
|---|---|
| `components/TrendsView.tsx` | The whole view (trigger panel, markets, augmentation editor, ratings) |
| `services/aggregator.ts` | Typed client for the aggregator's API |
| `types.ts` / `components/Sidebar.tsx` / `App.tsx` | `trends` view + nav entry |
| `vite.config.ts` | `/aggregator` proxy (target from `AGGREGATOR_URL`, default `:3002`) |
| `i18n/translations.ts` | `trends` label for en/zh/ja/ko |

Both services must be running: `ace-step-ui` (3000/3001/8001) and the aggregator
(3002, via `start-aggregator.bat`). The view degrades honestly if the aggregator is
down — it says so and points at the launcher.

## The lyric arc

Every scaffold is written to one narrative arc:

```
perspective → uncertainty → agency → contradiction →
concrete metaphor → scale expansion → unresolved or reframed conclusion
```

Each stage constrains *what a section is doing*, and the writer supplies the
grammar. The mapping adapts to the genre's energy (all seven stages always appear):

| Section | Stage(s) | Example (Afrobeats, NG) |
|---|---|---|
| Verse 1 | perspective + uncertainty | "It's golden hour in a rented room" / "I don't know if I can hold this" |
| Chorus | contradiction | "I call it off, but I show up anyway" / "I'm steady, still shaking" |
| Verse 2 | concrete metaphor + agency | "There's a door left open" / "So I pay the price" |
| Bridge | scale expansion | "It's not just me, it's the ones still driving home" |
| Closing chorus / Outro | unresolved or reframed conclusion | "(You and I keep the light on, or maybe we don't)" |

Design decisions worth knowing:

- **Concrete metaphors are genre-native.** Each genre family has its own bank, so a
  country concept draws "a screen door that won't close", a dance one "a strobe that
  keeps the time", J-pop "an umbrella left on the train", Afrobeats "a wrapper folded
  into a ring" (`src/design/imagery.ts`). A general bank backstops uncategorised genres.
- **The conclusion is deliberately not a resolution.** Either the closing chorus keeps
  the hook's words but qualifies them ("…, or maybe we don't"), or the hook repeats and
  the outro carries an open line ("We never did decide"). Nothing ties a bow.
- **Chorus repeats are byte-identical** except that closing chorus, so the hook is
  actually a hook.
- **Grammar lives in the language pack, not in shared templates.** Banks are written
  for one template each and places are split by preposition, so "on a rented room" is
  impossible; French computes elision (`je` → `j'`) and German binds case-correct noun
  phrases. External words (chart terms) are only used as ad-libs, and only in English
  lyrics, since a foreign token in a French or German line is its own kind of bug.
- **Section headers stay plain** (`[Verse 1]`, `[Chorus]`) because that is the format
  ACE-Step parses. The arc is reported separately (`concept.params.lyricArc`) and shown
  in the UI's augmentation panel, next to the metaphor, contradiction, conclusion and
  the section→stage map.

**Honest limitation:** this is a scaffold, not finished lyric writing. With
`THINKING=true` the ACE-Step LM rewrites and localises it; it may smooth, reorder or
replace lines, so treat the arc as the brief the rewrite works from rather than a
guarantee about the final sung words. Occasional word-level echoes across sections
(for example "certain" appearing twice) are also expected at this stage.

Preview the arc without touching the pipeline:

```bash
npx tsx scripts/lyric-preview.ts 42   # 10 market/genre/language cases + singability
```

## Languages and singability

Lyrics are written by a **language pack** (`src/design/lyrics/`) that owns both its
phrase banks *and* its grammar. There are no shared templates, because grammar
cannot be abstracted: French needs elision and gender agreement, German puts the
finite verb at the end of a subordinate clause, and Japanese needs particles and no
plural agreement at all. A pack is the smallest unit that a speaker of the language
can verify.

| Pack | Status | Notes |
|---|---|---|
| `en` English | complete | banks in `src/design/lyricBanks.ts` |
| `fr` French | complete | "on" as collective subject (3rd-person singular verb, so no plural agreement to get wrong); elision computed (`je` → `j'` before a vowel); self-descriptions kept adverbial to avoid gendered predicative adjectives; the scale expansion uses whole pre-agreed clauses |
| `de` German | complete | nominative-only interpolation so article case cannot break; uncertainty uses full subordinate clauses so the verb-final rule holds by construction; inversion after fronted adverbs ("Also nehme ich das Steuer"); separable verbs avoided |
| `ja ko zh hi pt es it nl ru ar …` | **pending** | no pack yet |

**The critical fix.** Previously a concept for the Japanese market carried
`vocal_language: 'ja'` while its lyrics were English — the engine was asked to sing
English words as Japanese and nothing in the pipeline noticed. Now:

- `concept.vocalLanguage` is the language the lyrics are **actually written in**, so
  only `en`/`fr`/`de` can ever be sent to the engine;
- a market whose language has no pack falls back to English and this is **reported**,
  not hidden — in the rationale, the CLI output, `params.requestedLanguage`,
  `params.lyricLanguageFallback` and the UI.

To add a language: create `src/design/lyrics/<code>.ts` implementing `LanguagePack`
(see `fr.ts` as the reference), register it in `lyrics/index.ts`, and add its code to
that pack list.

### Singability gate

`src/design/lyrics/validate.ts` measures every generated lyric before it is stored and
records the result in `concept.params.lyricValidation`:

| Measure | What it catches |
|---|---|
| `meterFit` | lines too long/short for the tempo and meter (target ≈ two bars, tempo-scaled) |
| `scriptConsistency` | text in the wrong script (English words in a Japanese market) |
| `rhymeDensity` | whether adjacent lines rhyme or assonate at all |
| `repetition` | a section repeating its own line (chorus repeats across sections and the closing bookend are excluded) |
| `cliches` | borrowed per-language cliches ("heart of gold", "danser sous la pluie") |

The score is a weighted aggregate that is deliberately explainable, and `issues`
names the specific offending lines. **Syllable counts are orthographic estimates**
(no phonemizer), so they are used as bands, not exact targets — the value is catching
a 20-syllable line at 126 BPM.

Building this immediately paid for itself: it caught an 18-syllable English
contradiction line, a 15-syllable scale-expansion line in both French and German, and
a `scriptConsistency` ratio above 1 caused by counting `[Chorus]`'s brackets as Latin
letters. French meter fit went from 0.73 to 0.91 and German from 0.78 to 0.96 after
acting on what it flagged.

## Forecasting

`src/forecast/forecast.ts` projects where a market is heading, using **damped linear
extrapolation, not a learned model**: per-track rank velocity and genre-share drift,
clamped and scaled by how much history exists.

- Honest by construction: each market reports its own sample depth
  (`insufficient | low | moderate | high`) and carries a `caveat` naming how many more
  days of collection are needed. With one or two passes the caveat says the numbers are
  not yet meaningful, and `bestGenreBet()` returns `null` rather than picking the top of
  a noisy list.
- Damping matters: an undamped fit projected `country` from 38% to **97%** of the US
  chart in a week. Crediting a fraction of the observed drift at low sample depth brings
  that to 47% with a confidence of 0.05 — still flagged, but no longer nonsense.
- `risingTracks` lists tracks with projected rank gains and their confidence, with the
  physical bounds applied (nothing climbs past #1).

Because a forecast needs at least two collection passes on two different days, the
scheduler exists to make that possible:

```bash
npm run schedule                      # long-running periodic collection + briefs
npm run serve -- --schedule           # dashboard/API with the scheduler on
npm run forecast -- --market us --horizon 7
```

`SCHEDULE_ENABLED=false` by default, so a CLI run never starts a background timer
unasked. One timer, no overlap: if a pass takes longer than the interval the next tick
is skipped rather than queued, so a slow network cannot pile up parallel collections
against the public chart APIs.

## Quickstart

Requires the ACE-Step pipeline to be up (`ace-step-ui\start-all.bat`, ports
3000/3001/8001) and Node 18+.

```bash
cd signal-aggregator
npm install
cp .env.example .env          # markets, thresholds, optional API keys

npm run collect               # pull charts for every configured market
npm run brief                 # build market briefs from those signals
npm run design                # design songs for each market
npm run run -- --limit 2      # render 2 of them through ACE-Step
npm run report                # cross-nation trend view
npm run serve                 # dashboard + API on http://localhost:3002
```

Or do all of it in one go:

```bash
npm run cycle -- --generate 2        # collect → brief → design → render → score
```

## Commands

| Command | Purpose |
|---|---|
| `npm run collect` | Fetch and store signals; enriches the top rows with canonical genre + duration |
| `npm run brief` | Derive per-market profiles (genre mix, tempo, momentum, themes) |
| `npm run design` | Design concepts from the latest briefs and learned weights |
| `npm run run` | Render designed concepts and score them |
| `npm run cycle` | The whole loop; `--generate N` controls how many songs get rendered |
| `npm run report` | Cross-nation overview (add `-- --market us` for one market) |
| `npm run forecast` | Forward view: rising tracks, genre drift, tempo projection, with sample-depth caveats |
| `npm run schedule` | Long-running periodic collection (+ briefs); keeps history accumulating |
| `npm run rate -- --run <id> --score 0.8` | Record a human rating; re-scores the run and updates weights |
| `npm run serve` | Dashboard + HTTP API (`--schedule` also starts the collector) |
| `npm run typecheck` | TypeScript check |

Useful flags: `--markets us,gb --enrich 20 --count 3 --seed 42 --reuse
--instrumental --no-global`. Note that with `npm run`, arguments need `--` first;
or call `npx tsx src/index.ts <command> ...` directly.

## The loop, concretely

```
collect → snapshot + signals      (each run is diffed against the previous one)
   ↓
brief   → genre mix / tempo / length / themes / momentum / confidence
   ↓
design  → concepts: style prompt, lyrics, bpm, key, meter, length, language
   ↓
render  → submit to ace-step-ui → poll → download audio → per-run manifest
   ↓
score   → market fit + novelty (+ human rating) → composite → verdict
   ↓
rate    → human score updates per-market weights (genre/tag/bpm/key)
   ↓
next cycle designs with those weights
```
## Signal sources

| Source | Key needed | What it gives |
|---|---|---|
| Apple Music most-played (per storefront) | none | Ranked top tracks per country, **localized** genres, release date, catalog id |
| iTunes lookup | none | Canonical genre, track duration, release date for a specific catalog id |
| Deezer charts | none | Worldwide + per-genre charts (benchmark and genre depth) |
| Spotify / Last.fm / YouTube | optional keys | Not wired in yet; blank keys simply disable them |

Localized genre names (`ロック`, `Música`, `Hip-hop/Rap`, `ヒップホップ／ラップ`) are
normalized into one taxonomy (`src/analysis/genres.ts`) so markets can be compared.
Unmapped labels are never discarded — they stay in `signals.genres` and are bucketed
as `other` in distributions.

## Scoring

`market_fit` is a weighted blend of explainable components, each recorded in the
run's `breakdown`:

| Component | Weight | Measures |
|---|---|---|
| `genre` | 0.35 | Chosen genre's weighted share of that market's chart |
| `bpm` | 0.30 | Distance from the market's tempo target (±30 BPM ramp) |
| `duration` | 0.13 | Distance from the market's typical song length |
| `key` | 0.12 | Learned key preference (neutral 0.6 until ratings exist) |
| `language` | 0.10 | Vocal language inside the market's language set |

`novelty` measures overlap with the current chart: copying the chart and going
fully alien both score low; a modest overlap is rewarded.

`composite` = market fit (0.5) + novelty (0.2) + human rating (0.3) once rated.
Until a rating exists the composite is a proxy-only blend (weights renormalised)
and the verdict is `unrated` — never presented as market evidence.

## Learning rules

- Only **human ratings** move the weights (`genre:*`, `tag:*`, `bpm:*`, `key:*`,
  clamped to 0.25–3.0). A model grading its own output is not evidence that a
  market liked a song, so proxy scores never train anything.
- Ratings re-score the run immediately, so a rating changes what the next design
  cycle prefers before you run it.
- `bump = learningRate * (rating - 0.5)`: above-average songs get their genre,
  tags, tempo band and key reinforced; below-average ones get damped.

## Honest limitations

- **Tempo is mostly inferred, not measured.** Deezer's public API now returns
  `bpm: 0` for almost every track (0 of 190 chart rows in testing), so market
  tempo starts from genre norms. Each brief states its basis
  (`tempoSource: measured | blended | hinted`), and once you rate songs the
  learned tempo bands take over.
- **Key signatures are genuinely unknown.** No public feed used here exposes them,
  so `keyWeights` starts empty and keys follow genre conventions until ratings earn
  a preference. The `key` score component stays neutral (0.6) until then.
- **Momentum needs two collections.** The first run per market is a baseline and
  says so; churn/new-entry numbers only appear after the next collection.
- **Lyrics are written in `en`, `fr` or `de`; other markets fall back to English.**
  Structure and topics still come from the market's themes, and with `THINKING=true`
  the ACE-Step LM rewrites them — but the language the engine is told to sing is always
  the one the lyrics are written in. See "Languages and singability" above. Pending
  packs: `ja ko zh hi pt es it nl ru ar`.
- **Forecasts are not usable yet.** They are implemented and damped correctly, but the
  database currently holds a single day of history, so every market reports
  `depth: insufficient` with a caveat. Real forecasts need the scheduler to run for
  roughly a week or more.
- **"Trends" here means chart popularity**, the strongest free signal available.
  It is not streaming counts or revenue.
- **Human ratings are required for real market evidence.** The loop works without
  them, but it will tell you when it is guessing.
- Chart artists appear as market *context* only. Designs are generated from genre,
  tempo and structure evidence, with original titles — no artist's song is imitated.

## Configuration

Key `.env` values (`src/config.ts` holds the full list with defaults):

| Variable | Default | Meaning |
|---|---|---|
| `MARKETS` | `us,gb,fr,de,br,jp,in,ng` | Storefront codes to aggregate |
| `ACESTEP_UI_URL` | `http://localhost:3001` | Local ace-step-ui backend |
| `DURATION` / `CONCEPTS_PER_MARKET` | `120` / `3` | Design defaults |
| `THINKING` / `ENHANCE` | `true` | Let the LM enrich captions/lyrics |
| `WEIGHT_MARKET_FIT` / `_NOVELTY` / `_HUMAN` | `0.5` / `0.2` / `0.3` | Composite weights |
| `CHAMPION_THRESHOLD` / `VIABLE_THRESHOLD` | `0.70` / `0.55` | Verdict cutoffs |
| `LEARNING_RATE` | `0.25` | How hard a rating moves weights |

## HTTP API

| Endpoint | Purpose |
|---|---|
| `GET /` | Dashboard: market cards, rating queue with audio players, latest runs |
| `GET /api/overview` | Machine-readable market overview |
| `GET /api/markets/:cc` | Brief, concepts, runs, learned weights, rating queue |
| `GET /api/report/overview` · `/api/report/market/:cc` | Text reports |
| `POST /api/collect` · `/api/design` · `/api/cycle` | Drive the loop |
| `GET /api/forecast` · `/api/forecast/:cc` | Forecasts (+ the CLI's text form verbatim, caveat included) |
| `GET /api/schedule` · `POST /api/schedule/run` | Collector state; run one pass now |
| `POST /api/ratings` | `{ runId, score, notes? }` → re-score + learn |

## Files

```
src/
  analysis/   genres.ts  tempo.ts  metrics.ts  series.ts   normalization + evidence + time series
  sources/    apple.ts deezer.ts itunes.ts store.ts collect.ts
  briefs/     build.ts types.ts                    market profiles
  design/     designer.ts prompt.ts lyrics.ts genreStyle.ts marketFlavor.ts store.ts
  design/lyrics/  index.ts types.ts en.ts fr.ts de.ts validate.ts   language packs + singability gate
  forecast/   forecast.ts                          damped projections with sample-depth confidence
  schedule/   scheduler.ts                         periodic collection (history for forecasting)
  pipeline/   client.ts submit.ts run.ts            ACE-Step integration
  scoring/    fit.ts score.ts                       scoring + learning
  loops/      cycle.ts rate.ts store.ts ratings.ts  the loop itself
  report/     overview.ts detail.ts forecast.ts format.ts   reporting
  api/        server.ts dashboard.ts
  db/         index.ts migrate.ts    cli/args.ts     index.ts (CLI)
scripts/db-stats.ts                                data-quality report
scripts/lyric-preview.ts                           arc + grammar + singability preview
scripts/inspect-concepts.ts                        language provenance per concept
```