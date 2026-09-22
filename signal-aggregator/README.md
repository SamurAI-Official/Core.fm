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
  phrases. External words (chart terms) are only used as ad-libs, and only when the word
  is written in the pack's **own script** — a Latin chart word is never injected into a
  Korean or Chinese line, while a Korean chart word is now usable in one.
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
npx tsx scripts/lyric-preview.ts 42   # 13 market/genre/language cases + singability
```

## What a song is about (subjects)

The banks alone told one story — midnight, staying or leaving, ambivalence — and the
market's own topics never reached the lyrics: `themes` was accepted and ignored, and
`terms` only ever fed a single English ad-lib. A generator that cannot be about anything
else is subject-constrained however good its grammar is, so the subject is now an
explicit, reported decision.

| Piece | Where | What it does |
|---|---|---|
| `SUBJECTS` | `design/lyrics/subjects.ts` | six subjects (leaving and staying; city life and work; family and distance from home; celebration and hustle; memory and loss; starting over), each with the chart words and theme phrases that point at it, plus the imagery families it prefers |
| `chooseSubject()` | `design/lyrics/subjects.ts` | chooses per song: matched from the market's chart words and flavour themes when the script can be compared, otherwise a seeded, rotating draw |
| `subjectCoverage` | each pack | the subjects a pack writes natively. Only these are ever chosen for it, so a subject the pack cannot write is impossible to label a concept with |
| `SubjectTable` | each pack | that pack's own material for a subject: an intro ad-lib, a self-description bank, and stage banks. Any slot a subject omits falls back to the general bank |

Consequences worth knowing:

- **A design run rotates.** `designConcepts` reads the market's previous subjects back
  out of the store and passes them as exclusions, so three designs in one batch are
  three different subjects and a later run does not repeat the last one.
- **The material comes from the market's own sample.** `terms` are the chart's frequent title
  words and `themes` are the phrases its titles keep returning to (`chartThemes`: adjacent
  content-token pairs recurring across several tracks, rank-weighted, artist tokens removed), both
  mined from the collected signals at brief time. `lyricThemesFor` puts the mined phrases *first*
  and keeps the static regional table behind them: measured across the ten markets, the mined words
  alone (`need`, `love`, `last`) match no subject keyword at all - chart-topic matching fell to
  0/24 designs in nine of ten markets - while the curated phrases are what make the catalogue
  reachable. `params.lyricThemeSource` records which layer led, alongside `params.lyricThemes`.
- **The chart's word reaches the lyric.** `pickTopicWord` takes a chart term that is in the pack's
  own script and renders it as the intro ad-lib, so a market's vocabulary appears verbatim rather
  than only as a hint. That line was wired up in only three packs (`en`, `ko`, `zh`) - the other six
  ignored it - so one signal produced a chart-word ad-lib in some markets and a generic one in
  others; all nine packs now prefer it, and `params.topicWord` records it per concept.
- **Non-Latin charts rotate rather than match.** Keyword matching compares English
  keywords, so a Korean or Chinese chart cannot be matched against them; those markets
  rotate through the catalogue instead. Rotation is therefore a first-class path, not a
  fallback of last resort — and the Korean and Chinese packs carry all six subjects.
- **Partial coverage is safe and labelled.** A pack can add one subject at a time (the
  European packs carry three each today), and `params.lyricSubjectRealised` records
  whether the writing pack had material for the subject that was chosen.
- **Imagery follows the subject 60% of the time**, and the genre's own family the rest,
  so a screen door still reads country.
- **Everything is recorded**: `params.lyricSubject`, `lyricSubjectLabel`,
  `lyricSubjectSource` (`chart-topic` | `rotation` | `seeded`), `lyricSubjectMatched` and
  `lyricSubjectRealised`, and the rationale names the subject and where it came from.

Check the whole thing — coverage, rotation, that a forced subject really changes the
lyrics, and that chart words drive it:

```bash
npm run test:subjects
```

## How a song is built (writing styles)

The seven-stage arc used to be the *only* structure, so every market, genre and subject was
told the same way. A **writing agent** is a named way of building a song: all twenty from the
songwriting brief are implemented, in every language, and `arc` remains the default so no
existing concept changes shape.

```ts
interface WritingAgent {
  id, name, engine[], blurb          // engine = the chain, e.g. ['question','partial answer',...]
  needs: PrimitiveId[]               // whole-line material the style requires from a pack
  repetition: 'fault' | 'device'     // is a repeated line a defect here, or the technique?
  fits?({ genre, energy }): number   // affinity weight for selection
  plan({ energy, rng }): AgentPlan   // sections, roles, line budgets, variants
  write(section, ctx, pack, used)    // arrangement -> lines, through the pack's banks
  report?(ctx, plan, pack)           // what this style did, stored on the concept
}
```

| Style | Engine | Needs from the pack | Status |
|---|---|---|---|
| `arc` Narrative arc *(default)* | perspective → uncertainty → agency → contradiction → concrete metaphor → scale → conclusion | — | implemented |
| `hook-variation-payoff` Hook → Variation → Payoff | claim → repetition → contradiction → reinterpretation → return | implication | implemented |
| `question-answer` Question → Answer → Bigger Question | question → partial answer → consequence → new question | question, answer | implemented |
| `specific-universal` The Specific → Universal | tiny physical detail → emotional implication → larger human truth | implication, universal | implemented |
| `promise-violation` Promise → Violation → Repetition | expectation → anticipation → violation → recognition | claim, reversal | implemented |
| `confession-denial` Confession → Denial → Confession | reveal → retreat → deeper reveal | claim, reversal | implemented |
| `image-meaning` Image → Image → Image → Meaning | concrete image → image → pattern → emotional realisation | — (prefers `universal`) | implemented |
| `character-choice` Character → Choice → Consequence | person → desire → dilemma → choice → consequence | claim | implemented |
| `escalating-stakes` The Escalating Stakes | small consequence → larger → irreversible | ladder | implemented |
| `false-resolution` The False Resolution | conflict → apparent resolution → destabilising detail → new conflict | reversal | implemented |
| `call-response` Call → Response → Escalation | statement → response → repetition → variation → escalation | question, answer | implemented |
| `slogan-story` Slogan → Story | simple thesis → examples → contradiction → expanded thesis | — | implemented |
| `countdown` The Countdown | deadline → progression → decreasing time → decision | deadline, ladder | implemented |
| `thought-actually` The "I Thought X / Actually Y" | belief → evidence → contradiction → revised belief | claim, reversal | implemented |
| `object-symbol` The Object Becomes the Symbol | object → repetition → association → transformation | — | implemented |
| `everybody-says` The "Everybody Says → I Say" | common belief → personal evidence → contradiction → personal conclusion | claim, reversal, universal | implemented |
| `groove-return` The Groove → Disruption → Return | pattern → repetition → disruption → return | — (prefers `fragment`) | implemented |
| `one-line-premise` The One-Line Premise | compressed premise → unanswered implication → expansion | — | implemented |
| `circular` The Circular Song | opening image → journey → revelation → return to the opening image | — | implemented |
| `missing-character` The Listener as the Missing Character | evidence → omission → listener inference → realisation | — | implemented |
| `refrain-mutation` Refrain With Semantic Mutation | same phrase → new context → new meaning → new context → transformed meaning | — | implemented |

**Agents arrange; packs supply the words.** A style asks for *roles* and *primitives*, never
for words, so Korean and French grammar stay where they are verified.

- **Primitives are whole lines.** `render` banks complete a template the pack owns; a
  primitive (`question`, `answer`, `claim`, `reversal`, `implication`, `universal`, `ladder`,
  `deadline`, `fragment`) is placed by the agent, so an entry must read correctly standing alone.
  Coverage is derived from the table - a primitive exists when it has entries - and all nine
  packs carry all nine primitives, which is why every style is available in every language.
- **A style is never chosen for a language that cannot write it.** Selection is
  coverage-filtered, so a style's `needs` gate it exactly as `subjectCoverage` gates a
  subject. Forcing one anyway (the UI's rewrite path) is honoured and *reported* rather than
  silently substituted: `params.lyricAgentRealised: false`, and the style degrades onto the
  pack's general material instead of crashing.
- **A reframe must actually reframe.** `boundedReframe` attaches the pack's qualifier to the hook
  when the result fits the meter band, and returns the *qualifier alone* when it does not -
  never the bare hook, because a closing line word-for-word identical to the hook is not a
  reframe. The gate caught the first version doing that.
- **Repetition is a fault in most styles and the technique in some.** `validate.ts` takes a
  `repetitionPolicy`, so a refrain is not scored as a defect; the count is still reported
  (`repeatedLines`) and the gate asserts the device was really used.
- **Styles rotate.** `designConcepts` reads a market's previous styles back out of the store
  (`usedAgents`), weights the draw by `fits()`, and records the source
  (`rotation` | `affinity` | `seeded`). A batch of designs now varies in *how* it is told as
  well as in what it is about.
- **Everything is provenance**: `params.lyricAgent`, `…Name`, `…Engine`, `…Blurb`,
  `…Source`, `…Realised`, `…Summary`, `…Report` and `lyricStructure` (section → roles). The
  Trends augmentation panel renders a style, its engine chain and its shape for every style
  without knowing any style in particular, and `POST /api/concepts/:id/reroll-lyrics`
  rewrites one design with a chosen style - without a design run or a render.

Check the styles themselves - that each engine is really in its output, not just in its name:

```bash
npm run test:agents              # per style x per pack: bars + engine assertions + rotation
npx tsx scripts/agent-spread.ts --print   # the same, with a sample song per style
npx tsx scripts/lyric-preview.ts 42 --agent refrain-mutation
```

**Repetition is measured across the whole song, not per section.** A device style repeats on
purpose, and a per-section count cannot see a hook sung once in each of seven sections - which is
how `hook-variation-payoff` reached one line being 56% of a lyric (6 distinct lines in 16) in every
language, while the same gate required device styles to report no repetition at all. `validateLyrics`
now also reports `maxLineRepeats`, `maxLineShare`, `distinctLineShare` and `mostSungLine` across the
song, and `npm run test:agents` fails a style whose most-sung line exceeds 40% of it (35% for a
`fault` style) or whose distinct-line share falls under 50% (45% for `fault`). The distinct-share bar
sits deliberately *below* the range legitimate styles occupy: a repeated chorus is a real cost, and a
bar at the boundary would punish songwriting as if it were a defect.

Two commands act on *stored* designs rather than on the writer:

```bash
npm run lyric-audit                                  # what is stored: per style, worst offenders
npm run rewrite-lyrics -- --market=us --dry-run      # re-write from the current chart sample
npm run rewrite-lyrics -- --redraw --seed 2          # redraw the styles too, and get other songs
```

`rewrite-lyrics` re-runs the *lyric* half of the design for every stored concept: the market's
latest brief terms and its flavour themes, plus the concept's own genre, requested language, tempo and
meter. Title, style prompt, key, duration, batch size and seed are untouched; the writing style is
kept unless `--redraw` is passed, and its original source (rotation, affinity) survives rather than
being rewritten as "seeded", because a kept style was not drawn again. The draw is seeded from the
concept id plus the run seed, so one run is reproducible and the next one differs - "based on the
sample data each time" means a fresh draw against the current chart sample, not a frozen answer. The
rationale is rebuilt too, because it names the subject, the style and the singability score.

Two limits, stated plainly: `question-answer` guarantees *distinct* questions that
*lengthen* across the song, which is a proxy for rising stakes - semantic escalation needs the
`ladder` primitive's ordering to be meaningful in context, not just in the bank. And two
engines (`promise-violation`, `groove-return`) are half musical: the lyrical half is ours, the
melody side is carried into the style prompt as a hint and ultimately belongs to the engine.

## Languages and singability

Lyrics are written by a **language pack** (`src/design/lyrics/`) that owns both its
phrase banks *and* its grammar. There are no shared templates, because grammar
cannot be abstracted: French needs elision and gender agreement, German puts the
finite verb at the end of a subordinate clause, and Japanese needs particles and no
plural agreement at all. A pack is the smallest unit that a speaker of the language
can verify.

| Pack | Status | Notes |
|---|---|---|
| `en` English | complete | banks in `src/design/lyricBanks.ts`; the reference pack, with subject material for all six subjects |
| `fr` French | complete | "on" as collective subject (3rd-person singular verb, so no plural agreement to get wrong); elision computed (`je` → `j'` before a vowel); self-descriptions kept adverbial to avoid gendered predicative adjectives; the scale expansion uses whole pre-agreed clauses |
| `de` German | complete | nominative-only interpolation so article case cannot break; uncertainty uses full subordinate clauses so the verb-final rule holds by construction; inversion after fronted adverbs ("Also nehme ich das Steuer"); separable verbs avoided |
| `es` Spanish | complete | a single preposition ("en") is correct with every place, so no preposition table is needed; self-descriptions invariable and adverbial; scale expansion uses whole pre-agreed clauses |
| `it` Italian | complete | "in" is correct with every place, so no articulated-preposition table is needed; "Ho finito di…" instead of the gendered "sono stanco di…"; invariable adverbial self-descriptions |
| `pt` Brazilian Portuguese | complete | "em" contractions baked into the place phrases ("nessa rua", "no lado leste"); "a gente" takes a 3rd-person singular verb, so plural agreement cannot go wrong; invariable adverbial self-descriptions |
| `ru` Russian | complete | past tense is gendered and the singer's gender is unknown, so the pack writes present and future forms and uses the gender-neutral plural past where the past is unavoidable; prepositional phrases stored complete (case cannot be composed); short neuter forms agree with "всё" |
| `ko` Korean | complete | Hangul. No plural, gender or agreement at all, so the risk moves to **particles**: 은/는, 이/가, 을/를 depend on whether the preceding syllable has a final consonant, so they are baked into the bank entries rather than appended. Plain 한다/해체 style throughout; bare time nouns, because a wrong copula or politeness level is worse than none |
| `zh` Mandarin Chinese | complete | Han. No inflection either, so the risk moves to **measure words and word order**: banks are whole phrases and the templates add no particle that depends on the preceding syllable. One syllable per character; rhyme is treated as approximate because real Mandarin rhyme is a rime-plus-tone system orthography cannot express |
| `ja hi nl uk ar tr id ms th vi tl sv no da fi pl el ur he sw yo ig zu …` | **pending** | no pack yet — falls back to English and reports it |

**The critical fix.** Previously a concept for the Japanese market carried
`vocal_language: 'ja'` while its lyrics were English — the engine was asked to sing
English words as Japanese and nothing in the pipeline noticed. Now:

- `concept.vocalLanguage` is the language the lyrics are **actually written in**, so the
  engine is only ever told to sing a language a pack can write (`en`, `fr`, `de`, `es`,
  `it`, `pt`, `ru`, `ko`, `zh` today);
- a market whose language has no pack falls back to English and this is **reported**,
  not hidden — in the rationale, the CLI output, `params.requestedLanguage`,
  `params.lyricLanguageFallback` and the UI.

To add a language: create `src/design/lyrics/<code>.ts` implementing `LanguagePack`
(see `ru.ts` or `ko.ts` as the reference), register it in `lyrics/index.ts`, drop it
from `PENDING`, and gate it with `npm run test:packs -- <code>`. A new pack should also
declare `subjectCoverage` and its own subject material — a pack with no coverage still
works, but every concept it writes is reported as "general material only".

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

### Per-script support (all ten target languages)

The validator and the text layer are script-aware, because the earlier versions were
ASCII-only in ways that failed **silently**:

| Defect | Effect before | Now |
|---|---|---|
| No Cyrillic syllable branch | Russian lines measured as **1 syllable** (fell through to a Latin counter that strips non-Latin characters), so meter scoring was meaningless | explicit counter per script; a Russian line of 7 vowels measures 7 |
| Latin-only rhyme key | `rhymes()` returned false for every non-Latin pair, silently costing ru/ja/ko/zh **0.2 of every score** | per-script keys: Cyrillic final nucleus, Japanese trailing morae, Hangul decomposed vowel+batchim, Han final character |
| ASCII-only tokenizer | Japanese titles produced **zero tokens**, so jaccard-based comparisons all scored exactly 0 | Unicode word extraction; CJK runs become bigrams |
| Section headers in script share | `[Verse 1]` is Latin text, so **every** non-Latin language lost ~15% of its script score and raised a spurious warning | measured over lyric lines only |

Each script now has an **explicit entry** in `SYLLABLE_MODELS` and `rhymeKey`, so a
missing model surfaces as a visibly coarse estimate rather than a silent zero.
Script knowledge lives in one place (`src/lib/text.ts`) and is shared with the trend
pipeline, so the two cannot drift apart on what counts as Cyrillic.

**Tests:** `npm run test:lyrics` — 40 fixtures across Latin, Cyrillic, Japanese,
Hangul and Han, covering syllable/mora counts, script detection, tokenization,
chart-junk filtering, positive *and* negative rhyme cases, and accent-insensitive
cliché matching. `validate.ts` previously had **no tests at all**, which is exactly how
the two silent failures above survived; the suite now also pins the *old* behaviour so
it cannot return.

Two further gates cover the packs and the subject engine, and both are runnable without
the pipeline or a database:

- `npm run test:packs -- ru ko zh` — per pack: no language fallback, output in the
  right script, lines inside the meter band, and none of that language's clichés
  (`scripts/lyric-pack-acceptance.ts`);
- `npm run test:subjects` — every pack declares at least three subjects it can write, a
  run rotates through them, forcing a different subject changes the lyrics, a chart word
  in the pack's own script is usable as an ad-lib and a Latin one is rejected for it, and
  chart words actually drive the subject (`scripts/subject-spread.ts`);
- `npm run test:agents` — per writing style and per pack: the shared bars *plus* an engine
  assertion block for **every one of the 21 registered styles**, checked against the lyrics rather
  than against the style's own name. A registered style with no assertion block **fails** the gate,
  so a style cannot survive here as a label:
  - `refrain-mutation` — the refrain is sung three or more times and the repeated chorus is
    byte-identical
  - `question-answer` — questions come from the pack's bank without repeats and lengthen across
    the song
  - `one-line-premise` — the premise is sung twice or more and the song closes on it
  - `circular` — the closing section opens on the line the song opened with
  - `escalating-stakes` — four or more rungs sung, in the bank's own order
  - `countdown` — the deadline arrives within the first two sections, the obstacles stay in bank
    order (the clock cannot run backwards) and a decision closes the song
  - `specific-universal` — the universal line comes from the pack's bank and never leads the song
  - `image-meaning` — at least three distinct images, and the meaning arrives after them
  - `thought-actually` / `everybody-says` — the belief is stated before the evidence that tests it,
    and the revision comes after both
  - `call-response` — the calls are distinct within a song, the answer returns untouched three or
    more times, and the escalation is a different line, sung
  - `character-choice` — desire, dilemma, choice and consequence are all reported *and* all sung
  - `missing-character` — the cause is never explained: no sung line may come from the pack's
    `claim` or `universal` banks, even though the style may run on packs that have them
  - `slogan-story` — the slogan returns three or more times, is stated in three or more sections,
    and the bridge turns it against itself
  - `object-symbol` — the object appears three or more times, each with different lines around it
    (otherwise it is an object, not a symbol)
  - `groove-return` — the pattern returns four or more times, the break is a single line, and the
    last chorus is byte-identical to the first
  - `hook-variation-payoff` — the hook is sung four or more times and the reinterpretation is one of
    the pack's own `implication` lines, actually sung
  - `false-resolution` — the destabilising detail arrives *after* the resolution it undoes
  - `promise-violation` — the promise is broken after it is made
  - `confession-denial` — all three stages are sung and none is a restatement of another
  - `arc` — the arc report survives, repetition is still a fault, and the song is five or more
    sections long

  A style forced onto a pack that lacks its primitives is held to the quality bars only, and the
  number of skipped engine checks is **printed** rather than hidden. Rotation is checked never to
  hand a pack a style it cannot write, and a variety check runs across seeds
  (`scripts/agent-spread.ts`; `--print` adds a sample song per style).

### Two limits, stated plainly

- **Market fit and novelty remain structurally meaningless for non-Latin markets.**
  Measured on real Japan data: the tokenizer fix took rows yielding no tokens from
  **8 of 40 to 0 of 40**, and theme extraction recovered real Japanese terms — but mean
  chart overlap was **unchanged at 0.0021 → 0.0021**, because `titleSimilarity` compares
  an English style prompt against native-script titles. Different scripts correctly
  overlap zero. Fixing this needs a different metric (genre/tempo agreement rather than
  text overlap), not a better tokenizer, and is still open.
- **CJK rhyme is an approximation.** Real Mandarin rhyme is a rime-plus-tone system and
  Japanese assonance is mora-based; neither is derivable from orthography alone. The
  metrics are labelled as approximations rather than presented as linguistic fact.

**Proven on live data:** the Japan brief went from `19 terms | awich, paledusk,
sakurashimeji, buddiis` (romanised proper nouns only) to `20 terms | awich, paledusk,
ありふれた世界の果てに, 東京, …`, while US/GB/FR/DE/BR terms were unchanged — including
`movin'` keeping its apostrophe, confirming the Latin path did not regress.

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
| `npm run rewrite-lyrics` | Re-write stored designs' lyrics from each market's current sample (`-- --market=us --dry-run`, `--redraw`, `--seed N`) |
| `npm run lyric-audit` | Repetition of what is *stored*: per style, per market, worst offenders |
| `npm run run` | Render designed concepts and score them |
| `npm run cycle` | The whole loop; `--generate N` controls how many songs get rendered |
| `npm run report` | Cross-nation overview (add `-- --market us` for one market) |
| `npm run forecast` | Forward view: rising tracks, genre drift, tempo projection, with sample-depth caveats |
| `npm run schedule` | Long-running periodic collection (+ briefs); keeps history accumulating |
| `npm run rate -- --run <id> --score 0.8` | Record a human rating; re-scores the run and updates weights |
| `npm run feedback` | The preference ledger: what listeners said, and what they blamed |
| `npm run decay` | Let go of unconfirmed weights (`-- --dry-run` to be told what it would do) |
| `npm run serve` | Dashboard + HTTP API (`--schedule` also starts the collector) |
| `npm run typecheck` | TypeScript check |

Useful flags: `--markets us,gb --enrich 20 --count 3 --seed 42 --reuse
--instrumental --no-global`. Careful with `npm run`: options npm recognises - `--market`,
`--dry-run`, `--limit`, `--seed` - can be taken by npm itself even after `--`, which once turned a
"dry run" into a run that wrote. Pass those as `--key=value`
(`npm run rewrite-lyrics -- --market=us --dry-run`) or call `npx tsx src/index.ts <command> ...`
directly; `rewrite-lyrics` reads either form and refuses a market code it does not recognise rather
than quietly rewriting nothing.

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
- Weights also **decay** toward neutral when nobody confirms them for a while, so a
  handful of early opinions cannot shape a market for ever. See "Decay" below.

## Preference: likes, hard nos, and the agreement gate

A rating says "how good was this run". A **verdict** says "I want more of this" or
"never again" about a specific response to a prompt, and it comes from the dislike button in
the app. The two are different evidence and the learner treats them differently.

**A dislike is not a low score.** It takes a full step (`LEARNING_RATE`, 0.25) regardless of any
score beside it; a 0.4 rating takes 0.025. Reasons then decide *what* is blamed, so a complaint
lands on the part of the song that earned it:

| Reason | Weight keys it moves |
|---|---|
| `mix`, `vocals` | production tags only |
| `genre` | the genre |
| `tempo` | the tempo band |
| `lyrics`, `bad-lyrics`, `repetition` | the writing style, the subject, the themes |
| `language` | the language, the subject |
| `off-prompt` | genre, subject, production tags (the prompt-to-song translation) |
| `not-my-kind`, or no reason | everything the response carried |

**One listener cannot move a market.** Every verdict is recorded the moment it arrives, but it is
stored as one *vote* per weight key it blames, and votes only reach the weights when
`FEEDBACK_MIN_USERS` **distinct** listeners agree on the same key within `FEEDBACK_WINDOW_DAYS`:

- the same person judging five bad responses is one rater (their votes add magnitude, not agreement);
- three different people disliking the same tag is a pattern, and their votes are then applied
  together — the step is what the agreeing votes asked for, still clamped to 0.25–3.0;
- each promotion marks its votes as used, so the next promotion counts only what arrived since;
- a vote that never crosses the window simply goes stale.

Until a group crosses, `POST /api/feedback` reports it under `pending` ("2 of 3 listeners agree"),
and `GET /api/feedback` lists every waiting group — a slow learner you can watch rather than a
button that seems to do nothing.

**Retraction is real.** `verdict: 'none'` finds the caller's most recent verdict on the same
response and takes it out of the count: votes that had never crossed are released, and votes that
had already moved a weight are reversed by applying the opposite step. Reversal lands *roughly* on
the earlier value, because the weights are clamped — the response says exactly what it did.

**Two escape hatches.** `FEEDBACK_PROMOTE=false` records and reports but never writes, so a
deployment can watch the distribution of votes before letting any of them act. And
`FEEDBACK_MIN_USERS=1` makes one listener's verdict act at once, which is the honest setting for a
single-user install.

Where the votes come from: a song rendered through the aggregator carries its market and its design
provenance (`market`, `conceptId`, `runId`, `primaryGenre`, `lyricAgent`, `lyricSubject`,
`lyricThemes`) into the app's job params, so a verdict on the *audio* can be attributed back to the
design that made it. A song generated straight from the Create tab has no market; its verdict is
still recorded, with learning switched off, and becomes learnable if it is ever attributed.

## The listener's own profile (Layer U)

The gate above exists because one person should not decide what a *market* hears. It has no place in
what one person hears next: a hard no is their own statement about their own generation, it costs
nothing to honour, and it should change the very next thing they are offered. So the same verdict has
two destinations with two different rules:

| | market (Layer M) | listener (Layer U) |
|---|---|---|
| when it acts | when `FEEDBACK_MIN_USERS` distinct raters agree | immediately, on the verdict alone |
| where it is stored | `market_weights`, keyed by market | `user_weights`, keyed by rater |
| needs a market | yes | no - a Create-tab song's verdict still teaches |
| scope | `genre:`, `tag:`, `bpm:`, `key:` | those, plus `agent:`, `subject:`, `language:`, `theme:` |

Same key grammar and the same bounds (0.25-3.0), so the two can be read side by side - and blended
later - rather than being two vocabularies that cannot meet.

**A hard no produces another take.** `POST /api/next-take` decides what to change, and it obeys one
rule: **only change what the machine chose, never what the person wrote.**

| reason | what a retry changes | on a prompt the listener wrote |
|---|---|---|
| `tempo` | moves a whole tempo band (not a few BPM) | same |
| `key` | a different key in the same mode | same |
| `mix`, `vocals` | drops up to two production tags, the ones this listener's profile has damped first | same |
| `lyrics`, `repetition` | a different writing style (preferring one they have not objected to) and a new subject | *nothing* - the words are theirs |
| `genre`, `off-prompt` | a different genre for the same market, with its own style prompt | reported as theirs to change |
| `language` | reported, never changed silently: the language belongs to the market or to their prompt | reported |
| no reason given | everything above | the seed, and that is reported as such |

Every retry takes a seed that has never been heard for that prompt, and every change is written into
the song's params (`retryOf`, `retryRoot`, `retryAttempt`, `retryReasons`, `retryExcludedSeeds`,
`retryNote`) so "why is this different from what I asked for?" is answerable from the record rather
than by comparing two renders by ear. A writing style change rerolls the *words* through the loop's
own lyric writer, because a song whose params claim one style while its lyrics follow another is
worse than not changing the style at all.

`GET /api/users/:rater/profile` reports the profile as preferences (`prefers`, `avoids`) plus the
number of verdicts behind it. That count is the confidence, and it is reported rather than folded in:
the app's Create tab shows its suggestion row only once there is more than one verdict, and applies it
only when the listener clicks.

## Decay: an opinion goes stale

Learning only accumulates in one direction. Without something that walks it back, four hard nos drive
a key to its 0.25 floor and it stays there for ever - and now the same is true of a listener's own
profile, which one person can pin to the floor in four clicks. A weight is a summary of what *recent*
listeners wanted, not a permanent verdict on a genre.

So an untouched weight walks back toward neutral at `WEIGHT_DECAY_PER_WEEK`, default **2%/week**:
after a week, `(1 - rate)` of the distance from 1 is left.

| value | after 2 weeks | after 10 weeks | after 60 weeks |
|---|---|---|---|
| 0.25 (driven to the floor) | 0.280 | 0.387 | 0.777 |
| 3.00 (strongly favoured) | 2.921 | 2.634 | 1.595 |

A key that keeps being confirmed never moves: the clock only runs on weights nobody has touched.

- **Both scopes.** Market weights *and* listeners' own profiles. The failure this prevents applies
  equally to a market and to one person, and there is no reading of "an opinion goes stale" under which
  the individual's own profile should be the permanent one.
- **Two clocks.** `updated_at` is when a weight was last *learned*; `decayed_at` is when a pass last
  touched it. Decay runs from whichever is later, and a pass never rewrites `updated_at` - so "when did
  this change, and why" stays readable. A weight that is not worth a write keeps its clock running
  rather than being nudged by a rounding error.
- **Where it runs.** At startup (a service that was off for a month must not come back holding last
  month's opinions), on every scheduled pass, and at the head of a cycle - the last of those so a cycle
  designs from weights that reflect how long it has been since anything was confirmed. It is also
  `npm run decay` (`--dry-run` supported) and `POST /api/decay` with `{ "dryRun": true }`.
- **It composes.** Decay is a function of *time since the value last changed*, not of how often the pass
  runs, so a pass every six hours and a pass once a month leave the same weights.
- **Neutral is retired, not kept.** A weight that decays into the tolerance band (0.005) is deleted
  rather than kept as a `1.0` placeholder, so the tables stay a summary of current taste instead of an
  archive of everything ever judged. A preference that was *already* within the tolerance when it was
  written is kept and reported as untouched - deleting it on arrival would lose it and claim a
  "dropped back to neutral" that never happened. The history is in the ledger
  (`feedback`, `feedback_votes`), which nothing here touches.

Every pass can be observed: `GET /api/decay` reports when it last ran and the rule in force, and the
pass itself answers with what moved, what was retired, the largest shift, and up to five example keys.

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
- **Lyrics are written in nine languages** (`en`, `fr`, `de`, `es`, `it`, `pt`, `ru`,
  `ko`, `zh`); other markets fall back to English and that is reported rather than
  hidden. Structure, language and subject all come from the market's own evidence, and
  with `THINKING=true` the ACE-Step LM rewrites the scaffold — but the language the
  engine is told to sing is always the one the lyrics are written in. See "Languages and
  singability" above. Pending packs: `ja hi nl uk ar tr id ms th vi tl sv no da fi pl el
  ur he sw yo ig zu`.
- **Forecasts are not usable yet.** They are implemented and damped correctly, but the
  database currently holds a single day of history, so every market reports
  `depth: insufficient` with a caveat. Real forecasts need the scheduler to run for
  roughly a week or more.
- **"Trends" here means chart popularity**, the strongest free signal available.
  It is not streaming counts or revenue.
- **Human ratings are required for real market evidence.** The loop works without
  them, but it will tell you when it is guessing.
- **Preference learning is slow by design, and that is the point.** A verdict is recorded
  instantly but a market only moves when `FEEDBACK_MIN_USERS` distinct listeners agree, so a
  single-listener install will see verdicts pile up as `pending` and no weights change until
  `FEEDBACK_MIN_USERS=1` is set. The gate exists because the alternative — the first person to find
  the button shaping a market — is worse. See "Preference" above.
- **Agreement is counted in people; magnitude is counted in votes.** Three listeners who each
  dislike one response move a key by three steps; one of them disliking three responses adds
  magnitude to the group without adding agreement. The bounds (0.25–3.0) and the planned decay are
  what keep that from compounding without limit.
- **A promoted step is only *roughly* reversible.** Retracting a verdict applies the opposite delta,
  and because weights are clamped, a reversal of a step that was itself clamped cannot land on the
  exact earlier value. The response reports the value it actually reached.
- **A lyric complaint has nothing to blame on a prompt nobody designed.** If a listener writes their own
  prompt, no writing style or subject was chosen for them, so `lyrics` / `bad-lyrics` moves nothing in
  their profile and a retry leaves the words alone (and says so). It is not a silent no-op: it is the
  only honest answer, because inventing a style to blame would be inventing the complaint.
- **A retry cannot avoid a take whose seed was random.** The engine is handed an explicit seed it
  records, so a take can be excluded by name - but a take rendered from a *random* seed does not record
  which seed it used, so a retry can only replace it with an explicit one. The response says so rather
  than implying the old take is unreachable.
- **Only the listener's own verdicts move their profile.** The profile is not a market's opinion of
  them, and other listeners' votes never reach it - which is why a single-user install still gets a
  useful Layer U while its Layer M stays deliberately still.
- **Decay is time-based, so it needs a clock you trust.** A machine whose system time jumps forward will
  age every weight at once (the pass caps the span at ten years to bound the damage, and reports the
  span it saw). Nothing else in the loop depends on wall-clock time this way.
- **A retired weight is not a forgotten one.** When a weight decays into the tolerance band the row is
  deleted, so the *weights* no longer show it - but its verdicts stay in the ledger for ever. Re-reading
  the history always works; re-deriving the weight needs a re-judgement, which is the intended cost.
- Chart artists appear as market *context* only. Designs are generated from genre,
  tempo and structure evidence, with original titles — no artist's song is imitated.

## Configuration

Key `.env` values (`src/config.ts` holds the full list with defaults):

| Variable | Default | Meaning |
|---|---|---|
| `MARKETS` | `us,gb,fr,de,br,jp,kr,cn,in,ng` | Storefront codes to aggregate. `kr` and `cn` are included so Korean and Chinese charts are designed in `ko`/`zh` rather than falling back to English |
| `ACESTEP_UI_URL` | `http://localhost:3001` | Local ace-step-ui backend |
| `DURATION` / `CONCEPTS_PER_MARKET` | `120` / `3` | Design defaults |
| `THINKING` / `ENHANCE` | `true` | Let the LM enrich captions/lyrics |
| `WEIGHT_MARKET_FIT` / `_NOVELTY` / `_HUMAN` | `0.5` / `0.2` / `0.3` | Composite weights |
| `CHAMPION_THRESHOLD` / `VIABLE_THRESHOLD` | `0.70` / `0.55` | Verdict cutoffs |
| `LEARNING_RATE` | `0.25` | How hard a rating moves weights |
| `WEIGHT_DECAY_PER_WEEK` | `0.02` | How fast an untouched weight walks back toward neutral, per week |
| `FEEDBACK_MIN_USERS` | `3` | Distinct listeners who must agree on a weight key before it moves. `1` acts on a single verdict (a single-user install) |
| `FEEDBACK_WINDOW_DAYS` | `30` | How long a vote counts toward a promotion |
| `FEEDBACK_PROMOTE` | `true` | `false` = record and report votes, never move a weight (shadow mode) |

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
| `GET /api/concepts`, `GET /api/concepts/:id`, `PATCH /api/concepts/:id` | List, read and edit a design |
| `GET /api/agents` · `GET /api/languages` | Writing styles and language options, straight from the registries (with the packs that can realise each style) |
| `POST /api/concepts/:id/reroll-lyrics` | Rewrite one design's lyrics with a chosen writing style - no design run, no render |
| `POST /api/concepts/:id/run` | Render a design through the pipeline |
| `POST /api/ratings` | `{ runId, score, notes? }` → re-score + learn |
| `POST /api/feedback` | `{ market?, verdict: like\|dislike\|none, rater?, sourceId?, reasons?, features?, learn? }` → record a preference and report what it moved (`applied`) and what is still waiting on other listeners (`pending`). `none` retracts the caller's last verdict on that response |
| `GET /api/feedback` | The ledger: summary (likes, dislikes, reasons, raters, promoted vs pending), recent verdicts with who gave them, and every group still short of agreement |
| `GET /api/users/:rater/profile` | A listener's own profile: what they want more and less of, and how many verdicts it is built from |
| `POST /api/next-take` | `{ rater, reasons, previous, excludeSeeds, attempt? }` → what to change for another take of the same prompt, with a note explaining each change |
| `POST /api/decay` · `GET /api/decay` | Run a decay pass (or `{ "dryRun": true }` to be told what it would do); get the rule in force and when it last ran |


## Files

```
src/
  analysis/   genres.ts  tempo.ts  metrics.ts  series.ts   normalization + evidence + time series
  sources/    apple.ts deezer.ts itunes.ts store.ts collect.ts
  briefs/     build.ts types.ts                    market profiles
  design/     designer.ts prompt.ts lyrics.ts genreStyle.ts marketFlavor.ts store.ts provenance.ts nextTake.ts
              (nextTake.ts: what a retry changes, given a rejection and a listener's profile)
  design/agents/   types.ts registry.ts arc.ts refrain-mutation.ts question-answer.ts
                   writing styles: arrangement + selection, one file per style
  design/lyrics/  index.ts types.ts subjects.ts primitives.ts en.ts fr.ts de.ts es.ts it.ts pt.ts ru.ts ko.ts zh.ts validate.ts
                  language packs, the subject catalogue, pack primitives, the singability gate
  forecast/   forecast.ts                          damped projections with sample-depth confidence
  schedule/   scheduler.ts                         periodic collection (history for forecasting)
  pipeline/   client.ts submit.ts run.ts            ACE-Step integration (submit carries attribution)
  scoring/    fit.ts score.ts feedback.ts            scoring, learning, what a verdict blames
  loops/      cycle.ts rate.ts store.ts ratings.ts feedback.ts promotion.ts userProfile.ts decay.ts
              the loop, the preference ledger, the agreement gate over its votes, each listener's
              own profile (which acts at once, unlike the gate), and the decay that lets go of what
              nobody has confirmed
  report/     overview.ts detail.ts forecast.ts format.ts   reporting
  api/        server.ts dashboard.ts
  db/         index.ts migrate.ts    cli/args.ts     index.ts (CLI)
scripts/db-stats.ts                                data-quality report
scripts/lyric-preview.ts                           arc + grammar + singability preview
scripts/lyric-pack-acceptance.ts                   per-pack gate: language, script, meter, cliches
scripts/subject-spread.ts                          subject coverage, rotation, chart-topic matching
scripts/lyric-repetition-audit.ts                  repetition of what is *stored*, per style and market
scripts/inspect-concepts.ts                        language and subject provenance per concept
```