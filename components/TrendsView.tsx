import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Globe,
  Loader2,
  Music,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Star,
  Wand2,
} from 'lucide-react';
import {
  trendsApi,
  type ConceptPatch,
  type MarketTrend,
  type TrendConcept,
  type TrendLanguage,
  type TrendRun,
} from '../services/aggregator';

interface TrendsViewProps {
  /** Toast bridge from App, so aggregation feedback uses the app's own toasts. */
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type Busy = null | 'collect' | 'design' | 'cycle' | 'run' | 'save' | 'rate';

const pct = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined ? '-' : `${(value * 100).toFixed(digits)}%`;

const score = (value: number | null | undefined): string =>
  value === null || value === undefined ? '-' : value.toFixed(2);

const shortId = (id: string | null | undefined): string => (id ? id.slice(0, 8) : '-');

/**
 * Fallback language list for the augmentation editor, used only until the aggregator
 * answers `GET /api/languages`. It is a fallback because a hard-coded list had already
 * drifted from reality: `ru` was missing here even though a Russian pack existed. The
 * real list is served by the service that owns the packs.
 */
const LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ko', 'zh', 'ja', 'hi', 'ta', 'ar', 'tr', 'id', 'sw', 'yo'];
const KEYS = [
  'C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor', 'D# major', 'D# minor',
  'E major', 'E minor', 'F major', 'F minor', 'F# major', 'F# minor', 'G major', 'G minor',
  'G# major', 'G# minor', 'A major', 'A minor', 'A# major', 'A# minor', 'B major', 'B minor',
];
const METERS = ['4/4', '3/4', '6/8'];

/** Editing buffer for the augmentation editor. */
interface ConceptDraft extends ConceptPatch {
  id: string;
}

/** The narrative arc the lyric writer used, as stored on the concept. */
interface LyricArcView {
  stages: string[];
  sectionMap: Array<{ section: string; stages: string[] }>;
  metaphor: string;
  contradiction: [string, string];
  conclusion: 'unresolved' | 'reframed';
  scaleSubject: string;
}

const STAGE_LABELS: Record<string, string> = {
  perspective: 'Perspective',
  uncertainty: 'Uncertainty',
  agency: 'Agency',
  contradiction: 'Contradiction',
  metaphor: 'Concrete metaphor',
  scale: 'Scale expansion',
  conclusion: 'Unresolved / reframed',
};

function readArc(concept: TrendConcept): LyricArcView | null {
  const raw = concept.params?.lyricArc as LyricArcView | undefined;
  if (!raw || !Array.isArray(raw.stages)) return null;
  return raw;
}

function draftFrom(concept: TrendConcept): ConceptDraft {
  return {
    id: concept.id,
    title: concept.title,
    style: concept.style,
    lyrics: concept.lyrics,
    bpm: concept.bpm,
    keyScale: concept.keyScale,
    timeSignature: concept.timeSignature,
    duration: concept.duration,
    vocalLanguage: concept.vocalLanguage,
    instrumental: concept.instrumental,
  };
}

const statusStyle = (status: string): string => {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/15 text-red-700 dark:text-red-300';
    case 'running':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300';
  }
};

export const TrendsView: React.FC<TrendsViewProps> = ({ showToast }) => {
  const [markets, setMarkets] = useState<MarketTrend[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof trendsApi.marketDetail>> | null>(null);
  const [runs, setRuns] = useState<TrendRun[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ConceptDraft>>({});
  const [openEditor, setOpenEditor] = useState<string | null>(null);
  const [rateNotes, setRateNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<{ healthy: boolean; url: string; detail?: string } | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  // Language options as reported by the aggregator's pack registry, plus the known codes
  // that still have no pack (offered, but labelled as an English fallback).
  const [languagePacks, setLanguagePacks] = useState<TrendLanguage[]>([]);
  const [pendingLanguages, setPendingLanguages] = useState<string[]>([]);

  // Trigger controls
  const [targetMarkets, setTargetMarkets] = useState<string[]>([]);
  const [perMarket, setPerMarket] = useState(1);
  const [renderCount, setRenderCount] = useState(1);
  const [reuseSignals, setReuseSignals] = useState(true);
  const [instrumental, setInstrumental] = useState(false);

  const pollTimer = useRef<number | null>(null);

  const notify = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'success') => {
      if (showToast) showToast(message, type);
    },
    [showToast],
  );

  const loadOverview = useCallback(async () => {
    try {
      const [{ markets: rows }, health, languageOptions] = await Promise.all([
        trendsApi.overview(),
        trendsApi.health(),
        // An older aggregator may predate /api/languages; the built-in list covers that
        // case instead of failing the whole overview.
        trendsApi.languages().catch(() => null),
      ]);
      setMarkets(rows);
      setPipeline(health.pipeline);
      if (languageOptions) {
        setLanguagePacks(languageOptions.languages);
        setPendingLanguages(languageOptions.pending);
      }
      setError(null);
      setTargetMarkets((current) => (current.length > 0 ? current : rows.map((row) => row.market)));
      return true;
    } catch (loadError) {
      setError(
        `${(loadError as Error).message} - start the aggregator with start-aggregator.bat (port 3002).`,
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMarket = useCallback(async (cc: string) => {
    try {
      const [marketDetail, runList] = await Promise.all([
        trendsApi.marketDetail(cc),
        trendsApi.runs({ market: cc, limit: 12 }),
      ]);
      setDetail(marketDetail);
      setRuns(runList.runs);
      const nextDrafts: Record<string, ConceptDraft> = {};
      for (const concept of marketDetail.concepts) nextDrafts[concept.id] = draftFrom(concept);
      setDrafts(nextDrafts);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setRuns([]);
      return;
    }
    void loadMarket(selected);
  }, [selected, loadMarket]);

  useEffect(
    () => () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    },
    [],
  );
/** Polls one run until the pipeline finishes, then refreshes the market. */
  const pollRun = useCallback(
    (runId: string, market: string) => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
      let ticks = 0;
      pollTimer.current = window.setInterval(async () => {
        ticks += 1;
        try {
          const { run } = await trendsApi.run(runId);
          setProgress(`render ${shortId(runId)}: ${run.status}${run.stage ? ` - ${run.stage}` : ''}${run.error ? ` - ${run.error}` : ''}`);
          if (run.status === 'succeeded' || run.status === 'failed') {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            pollTimer.current = null;
            notify(
              run.status === 'succeeded'
                ? `Render complete: market fit ${score(run.marketFit)}, composite ${score(run.composite)}`
                : `Render failed: ${run.error ?? 'unknown error'}`,
              run.status === 'succeeded' ? 'success' : 'error',
            );
            setBusy(null);
            setProgress('');
            await Promise.all([loadMarket(market), loadOverview()]);
          }
        } catch (pollError) {
          setProgress(`render ${shortId(runId)}: ${(pollError as Error).message}`);
        }
        if (ticks > 240 && pollTimer.current) {
          window.clearInterval(pollTimer.current);
          pollTimer.current = null;
          setBusy(null);
          setProgress('stopped polling after 20 minutes - check the run list.');
        }
      }, 5000);
    },
    [loadMarket, loadOverview, notify],
  );

  const handleCollect = async () => {
    setBusy('collect');
    setProgress('fetching charts for the selected markets...');
    try {
      const result = await trendsApi.collect({
        markets: targetMarkets.length > 0 ? targetMarkets : undefined,
        enrichTop: 12,
      });
      notify(`Collected ${result.totalTracks} signals (${result.enriched} enriched, ${result.errors} source errors)`);
      await loadOverview();
      if (selected) await loadMarket(selected);
    } catch (collectError) {
      notify((collectError as Error).message, 'error');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const handleDesign = async () => {
    setBusy('design');
    setProgress('designing songs from the latest briefs...');
    try {
      const result = await trendsApi.design({
        markets: targetMarkets.length > 0 ? targetMarkets : undefined,
        perMarket,
        instrumental,
      });
      notify(`Designed ${result.designed} song concept(s)`);
      await loadOverview();
      if (selected) await loadMarket(selected);
    } catch (designError) {
      notify((designError as Error).message, 'error');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const handleCycle = async () => {
    setBusy('cycle');
    setProgress('running a full cycle: collect -> brief -> design -> render. This takes minutes...');
    try {
      const result = await trendsApi.cycle({
        markets: targetMarkets.length > 0 ? targetMarkets : undefined,
        perMarket,
        generateLimit: renderCount,
        reuseSignals,
      });
      const rendered = result.executions.filter((execution) => execution.status === 'succeeded').length;
      notify(`Cycle complete: ${result.concepts.length} designed, ${rendered} rendered`);
      await loadOverview();
      if (selected) await loadMarket(selected);
    } catch (cycleError) {
      notify((cycleError as Error).message, 'error');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };
const handleSaveConcept = async (conceptId: string) => {
    const draft = drafts[conceptId];
    if (!draft) return;
    setBusy('save');
    try {
      const { concept } = await trendsApi.updateConcept(conceptId, draft);
      setDrafts((current) => ({ ...current, [conceptId]: draftFrom(concept) }));
      notify('Design updated');
    } catch (saveError) {
      notify((saveError as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /** Sends the (possibly augmented) design to the pipeline. */
  const handleGenerate = async (concept: TrendConcept) => {
    const draft = drafts[concept.id];
    const patch: ConceptPatch | undefined = draft
      ? {
          title: draft.title,
          style: draft.style,
          lyrics: draft.lyrics,
          bpm: draft.bpm,
          keyScale: draft.keyScale,
          timeSignature: draft.timeSignature,
          duration: draft.duration,
          vocalLanguage: draft.vocalLanguage,
          instrumental: draft.instrumental,
        }
      : undefined;

    setBusy('run');
    setProgress(`submitting ${concept.title} to the pipeline...`);
    try {
      const { runId } = await trendsApi.runConcept(concept.id, patch);
      notify(`Rendering ${concept.title} - this takes a few minutes`);
      setProgress(`render ${shortId(runId)}: queued`);
      pollRun(runId, concept.market);
    } catch (runError) {
      notify((runError as Error).message, 'error');
      setBusy(null);
      setProgress('');
    }
  };

  const handleRate = async (run: TrendRun, value: number) => {
    setBusy('rate');
    try {
      const result = await trendsApi.rate(run.id, value, rateNotes[run.id]);
      notify(
        `Rated ${shortId(run.id)} ${value}: composite ${result.composite} (${result.verdict})` +
          (result.learning.length > 0 ? ` | learned: ${result.learning.slice(0, 3).join(', ')}` : ''),
      );
      setRateNotes((current) => ({ ...current, [run.id]: '' }));
      await Promise.all([loadMarket(run.market), loadOverview()]);
    } catch (rateError) {
      notify((rateError as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (conceptId: string, patch: Partial<ConceptDraft>) => {
    setDrafts((current) => {
      const existing = current[conceptId];
      if (!existing) return current;
      return { ...current, [conceptId]: { ...existing, ...patch } };
    });
  };

  const toggleMarket = (cc: string) => {
    setTargetMarkets((current) =>
      current.includes(cc) ? current.filter((item) => item !== cc) : [...current, cc],
    );
  };

  const showReport = async (cc: string) => {
    try {
      setReportText(await trendsApi.marketReportText(cc));
    } catch (reportError) {
      notify((reportError as Error).message, 'error');
    }
  };

  // Options for the vocal-language select: real packs first (code plus English label),
  // then the codes that would fall back to English, labelled as such so choosing one is
  // an informed choice rather than a surprise.
  const languageChoices = [
    ...(languagePacks.length > 0
      ? languagePacks.map((pack) => ({ value: pack.code, label: `${pack.code} - ${pack.label}` }))
      : LANGUAGES.map((code) => ({ value: code, label: code }))),
    ...pendingLanguages.map((code) => ({ value: code, label: `${code} - falls back to English` })),
  ];

return (
    <div className="flex-1 overflow-y-auto scrollbar-hide px-4 md:px-8 py-6 pb-40">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              <Globe size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-zinc-900 dark:text-white">Trend Intelligence</h1>
              <p className="text-xs md:text-sm text-zinc-500 dark:text-zinc-400">
                What is popular by nation, designed into songs and tested per market
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pipeline && (
              <span
                className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 ${
                  pipeline.healthy ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'
                }`}
                title={pipeline.url}
              >
                <Activity size={13} />
                {pipeline.healthy ? 'pipeline ready' : 'pipeline offline'}
              </span>
            )}
            <button
              onClick={() => void loadOverview()}
              className="px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-xs flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-800 dark:text-amber-200">
            {error}
          </div>
        )}
{/* Trigger panel: the user drives the loop from here */}
        <section className="mb-6 rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-corefm-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wand2 size={16} className="text-pink-500" />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Run the loop</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">collect - design - render - rate</span>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {markets.map((market) => {
              const active = targetMarkets.includes(market.market);
              return (
                <button
                  key={market.market}
                  onClick={() => toggleMarket(market.market)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    active
                      ? 'bg-pink-500/15 border-pink-500/40 text-pink-300'
                      : 'border-zinc-300 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:border-pink-500/30'
                  }`}
                  title={`${market.name} - ${market.region}`}
                >
                  {market.market.toUpperCase()}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-3 text-xs text-zinc-600 dark:text-zinc-300">
            <label className="flex items-center gap-2">
              designs per market
              <input
                type="number"
                min={1}
                max={5}
                value={perMarket}
                onChange={(event) => setPerMarket(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
                className="w-14 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700"
              />
            </label>
            <label className="flex items-center gap-2">
              render
              <input
                type="number"
                min={0}
                max={8}
                value={renderCount}
                onChange={(event) => setRenderCount(Math.max(0, Math.min(8, Number(event.target.value) || 0)))}
                className="w-14 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700"
              />
              song(s)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={reuseSignals}
                onChange={(event) => setReuseSignals(event.target.checked)}
                className="accent-pink-500"
              />
              reuse existing signals
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(event) => setInstrumental(event.target.checked)}
                className="accent-pink-500"
              />
              instrumental only
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleCollect()}
              disabled={busy !== null}
              className="px-3.5 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50 text-xs font-medium flex items-center gap-2 text-zinc-800 dark:text-zinc-100"
            >
              {busy === 'collect' ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              Collect signals
            </button>
            <button
              onClick={() => void handleDesign()}
              disabled={busy !== null}
              className="px-3.5 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50 text-xs font-medium flex items-center gap-2 text-zinc-800 dark:text-zinc-100"
            >
              {busy === 'design' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Design songs
            </button>
            <button
              onClick={() => void handleCycle()}
              disabled={busy !== null}
              className="px-3.5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-xs font-medium flex items-center gap-2 text-white"
            >
              {busy === 'cycle' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run full cycle
            </button>
          </div>

          {(busy !== null || progress) && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              {busy !== null && <Loader2 size={12} className="animate-spin" />}
              {progress}
            </p>
          )}
        </section>
{/* Market cards - the "what is popular where" view */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
            <BarChart3 size={15} className="text-pink-500" />
            Markets
            {loading && <Loader2 size={13} className="animate-spin text-zinc-500 dark:text-zinc-400" />}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {markets.map((market) => {
              const isSelected = selected === market.market;
              return (
                <button
                  key={market.market}
                  onClick={() => setSelected(isSelected ? null : market.market)}
                  className={`text-left rounded-2xl border p-4 transition-colors bg-white dark:bg-corefm-card ${
                    isSelected
                      ? 'border-pink-500/50'
                      : 'border-zinc-200 dark:border-white/5 hover:border-pink-500/30'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-semibold text-sm text-zinc-900 dark:text-white">
                      {market.name}
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{market.market.toUpperCase()}</span>
                    </h3>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">conf {market.confidence.toFixed(2)}</span>
                  </div>

                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                    {market.trackCount} signals - {market.bpm || '-'} BPM ({market.tempoClass}
                    {market.tempoSource === 'measured' ? '' : `/${market.tempoSource}`}) - ~{market.durationMedian}s -{' '}
                    {market.languages.join('/')}
                  </p>

                  <ul className="mt-3 space-y-1">
                    {market.topGenres.slice(0, 4).map((genre) => (
                      <li key={genre.genre} className="flex items-center gap-2 text-[11px]">
                        <span className="w-24 truncate text-zinc-600 dark:text-zinc-300">{genre.genre}</span>
                        <span className="flex-1 h-1.5 rounded bg-zinc-200 dark:bg-white/10 overflow-hidden">
                          <span
                            className="block h-1.5 rounded bg-gradient-to-r from-pink-500 to-purple-500"
                            style={{ width: `${Math.min(100, genre.share * 300)}%` }}
                          />
                        </span>
                        <span className="w-9 text-right text-zinc-500 dark:text-zinc-400">{pct(genre.share)}</span>
                      </li>
                    ))}
                    {market.topGenres.length === 0 && (
                      <li className="text-[11px] text-zinc-500 dark:text-zinc-400">no signals collected yet</li>
                    )}
                  </ul>

                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-3">
                    {market.hasBaseline
                      ? `${pct(1 - market.overlapRatio)} churn - ${market.newEntries} new entries`
                      : 'baseline snapshot (momentum after the next collect)'}
                  </p>
                  {market.chartLeaders.length > 0 && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      {market.chartLeaders.join(' / ')}
                    </p>
                  )}
                  {market.themes.length > 0 && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      themes: {market.themes.slice(0, 5).join(', ')}
                    </p>
                  )}

                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-3">
                    {market.concepts} designs - {market.runs} runs - {market.rated} rated
                    {market.bestComposite !== null ? ` - best ${market.bestComposite.toFixed(2)}` : ''}
                    {market.champions > 0 ? ` - ${market.champions} champion(s)` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
{/* Selected market detail: brief, learned weights, designs, runs */}
        {selected && detail && (
          <section className="mb-6 rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-corefm-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {detail.brief ? `${detail.brief.summary.split(':')[0]}` : selected.toUpperCase()}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-3xl">
                  {detail.brief ? detail.brief.summary : 'No brief yet - run "Collect signals" then "Design songs".'}
                </p>
              </div>
              <button
                onClick={() => void showReport(selected)}
                className="px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-xs text-zinc-700 dark:text-zinc-200"
              >
                Full report
              </button>
            </div>

            {detail.brief && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                <span>
                  tempo {detail.brief.bpm.median} BPM ({detail.brief.bpm.tempoClass}, {detail.brief.tempoSource})
                </span>
                <span>typical length ~{detail.brief.durationMedian}s</span>
                <span>languages {detail.brief.languages.join('/')}</span>
                <span>
                  {detail.brief.momentum.hasBaseline
                    ? `${detail.brief.momentum.newEntries.length} new entries, ${detail.brief.momentum.droppedCount} dropped`
                    : 'baseline snapshot'}
                </span>
              </div>
            )}

            {detail.weights.filter((weight) => Math.abs(weight.value - 1) > 0.05).length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                  Learned preferences (from ratings) - these steer the next design:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.weights
                    .filter((weight) => Math.abs(weight.value - 1) > 0.05)
                    .slice(0, 12)
                    .map((weight) => (
                      <span
                        key={weight.key}
                        className={`px-2 py-0.5 rounded-full text-[11px] ${
                          weight.value >= 1 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {weight.key} x{weight.value.toFixed(3)}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </section>
        )}
      {/* Designs for this market: review, augment, then render */}
        {selected && detail && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
              <Music size={15} className="text-pink-500" />
              Song designs
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                edit any field, then render it through the pipeline
              </span>
            </h2>
            <div className="space-y-3">
              {detail.concepts.map((concept) => {
                const draft = drafts[concept.id] ?? draftFrom(concept);
                const isOpen = openEditor === concept.id;
                return (
                  <div
                    key={concept.id}
                    className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-corefm-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{draft.title}</h3>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {concept.primaryGenre} - {draft.bpm} BPM - {draft.keyScale} - {draft.timeSignature} -{' '}
                          {draft.duration}s - {draft.vocalLanguage}
                          {draft.instrumental ? ' - instrumental' : ''}
                        </p>
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 mt-1 max-w-3xl">{concept.rationale}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusStyle(concept.status)}`}>
                          {concept.status}
                        </span>
                        <button
                          onClick={() => setOpenEditor(isOpen ? null : concept.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-[11px] text-zinc-700 dark:text-zinc-200"
                        >
                          {isOpen ? 'Close' : 'Augment'}
                        </button>
                        <button
                          onClick={() => void handleGenerate(concept)}
                          disabled={busy !== null}
                          className="px-2.5 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-[11px] text-white flex items-center gap-1.5"
                        >
                          {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                          Render
                        </button>
                      </div>
                    </div>
{isOpen && (
                      <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            Title
                            <input
                              value={draft.title ?? ''}
                              onChange={(event) => updateDraft(concept.id, { title: event.target.value })}
                              className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                            />
                          </label>
                          <div className="grid grid-cols-4 gap-2">
                            <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              BPM
                              <input
                                type="number"
                                min={40}
                                max={220}
                                value={draft.bpm ?? 0}
                                onChange={(event) => updateDraft(concept.id, { bpm: Number(event.target.value) })}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                              />
                            </label>
                            <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Key
                              <select
                                value={draft.keyScale ?? 'C major'}
                                onChange={(event) => updateDraft(concept.id, { keyScale: event.target.value })}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                              >
                                {KEYS.map((key) => (
                                  <option key={key} value={key}>
                                    {key}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Meter
                              <select
                                value={draft.timeSignature ?? '4/4'}
                                onChange={(event) => updateDraft(concept.id, { timeSignature: event.target.value })}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                              >
                                {METERS.map((meter) => (
                                  <option key={meter} value={meter}>
                                    {meter}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              Secs
                              <input
                                type="number"
                                min={15}
                                max={300}
                                value={draft.duration ?? 0}
                                onChange={(event) => updateDraft(concept.id, { duration: Number(event.target.value) })}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                              />
                            </label>
                          </div>
                        </div>
<label className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                          Style prompt (genre, instrumentation, mood, local flavour)
                          <textarea
                            rows={3}
                            value={draft.style ?? ''}
                            onChange={(event) => updateDraft(concept.id, { style: event.target.value })}
                            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white font-mono"
                          />
                        </label>

                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            Vocal language
                            <select
                              value={draft.vocalLanguage ?? 'en'}
                              onChange={(event) => updateDraft(concept.id, { vocalLanguage: event.target.value })}
                              className="mt-1 px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white"
                            >
                              {!languageChoices.some((choice) => choice.value === (draft.vocalLanguage ?? 'en')) && (
                                <option value={draft.vocalLanguage ?? 'en'}>
                                  {draft.vocalLanguage ?? 'en'} - current value
                                </option>
                              )}
                              {languageChoices.map((choice) => (
                                <option key={choice.value} value={choice.value}>
                                  {choice.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 pb-2">
                            <input
                              type="checkbox"
                              checked={Boolean(draft.instrumental)}
                              onChange={(event) => updateDraft(concept.id, { instrumental: event.target.checked })}
                              className="accent-pink-500"
                            />
                            instrumental
                          </label>
                          <div className="ml-auto flex gap-2">
                            <button
                              onClick={() => void handleSaveConcept(concept.id)}
                              disabled={busy !== null}
                              className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50 text-[11px] text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5"
                            >
                              {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              Save changes
                            </button>
                            <button
                              onClick={() => void handleGenerate(concept)}
                              disabled={busy !== null}
                              className="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-[11px] text-white flex items-center gap-1.5"
                            >
                              {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                              Save &amp; render
                            </button>
                          </div>
                        </div>

                        {/* Lyric arc: what the narrative was built to do, so the user
                            can augment with the structure in view. */}
                        {(() => {
                          const arc = readArc(concept);
                          if (!arc) return null;
                          return (
                            <div className="rounded-xl bg-zinc-100 dark:bg-white/5 p-3 space-y-2">
                              {typeof concept.params?.lyricSubjectLabel === 'string' && (
                                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  About:{' '}
                                  <span className="text-zinc-900 dark:text-white">
                                    {String(concept.params.lyricSubjectLabel)}
                                  </span>
                                  {typeof concept.params?.lyricSubjectSource === 'string'
                                    ? ` (${String(concept.params.lyricSubjectSource)}${
                                        concept.params?.lyricSubjectMatched
                                          ? `: ${String(concept.params.lyricSubjectMatched)}`
                                          : ''
                                      })`
                                    : ''}
                                  {concept.params?.lyricSubjectRealised === false
                                    ? ' - general material only'
                                    : ''}
                                </p>
                              )}
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                Lyric arc (the structure the scaffold was written to)
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {arc.stages.map((stage, index) => (
                                  <React.Fragment key={stage}>
                                    {index > 0 && <span className="text-[11px] text-zinc-400">→</span>}
                                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-pink-500/15 text-pink-300">
                                      {STAGE_LABELS[stage] ?? stage}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                                <span>
                                  metaphor: <span className="text-zinc-900 dark:text-white">{arc.metaphor}</span>
                                </span>
                                <span>
                                  contradiction:{' '}
                                  <span className="text-zinc-900 dark:text-white">
                                    {arc.contradiction[0]} / {arc.contradiction[1]}
                                  </span>
                                </span>
                                <span>
                                  conclusion: <span className="text-zinc-900 dark:text-white">{arc.conclusion}</span>
                                </span>
                                <span>
                                  scale: <span className="text-zinc-900 dark:text-white">{arc.scaleSubject}</span>
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                {arc.sectionMap
                                  .map((entry) => `${entry.section}: ${entry.stages.map((s) => STAGE_LABELS[s] ?? s).join(' + ')}`)
                                  .join('  |  ')}
                              </p>
                            </div>
                          );
                        })()}

                        <label className="text-[11px] text-zinc-500 dark:text-zinc-400 block">
                          Lyrics (the LM rewrites and localizes these when thinking mode is on)
                          <textarea
                            rows={8}
                            value={draft.lyrics ?? ''}
                            onChange={(event) => updateDraft(concept.id, { lyrics: event.target.value })}
                            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-white font-mono"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
              {detail.concepts.length === 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No designs yet for this market - use "Design songs" above.
                </p>
              )}
            </div>
          </section>
        )}
{/* Runs + human rating: the market test step that feeds learning */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
            <Star size={15} className="text-pink-500" />
            Rendered songs &amp; market rating
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              ratings re-score the song and adjust what gets designed next
            </span>
          </h2>
          <div className="space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-corefm-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusStyle(run.status)}`}>
                      {run.status}
                    </span>
                    <span className="font-mono text-[11px]">{shortId(run.id)}</span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      fit {score(run.marketFit)} - novelty {score(run.novelty)} - composite {score(run.composite)}
                      {run.humanScore !== null ? ` - human ${run.humanScore.toFixed(2)}` : ' - unrated'}
                    </span>
                    {(run.status === 'running' || run.status === 'queued') && run.stage && (
                      <span className="text-[11px] text-amber-700 dark:text-amber-400">{run.stage}</span>
                    )}
                    {run.verdict && run.verdict !== 'unrated' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-purple-500/15 text-purple-700 dark:text-purple-300">
                        {run.verdict}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {[0.2, 0.4, 0.6, 0.8, 1].map((value) => (
                      <button
                        key={value}
                        onClick={() => void handleRate(run, value)}
                        disabled={busy !== null}
                        className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-white/5 hover:bg-pink-600 hover:text-white disabled:opacity-40 text-[11px] text-zinc-700 dark:text-zinc-200"
                        title={`Rate ${value} - does this fit the market?`}
                      >
                        {value}
                      </button>
                    ))}
                    <input
                      placeholder="notes"
                      value={rateNotes[run.id] ?? ''}
                      onChange={(event) => setRateNotes((current) => ({ ...current, [run.id]: event.target.value }))}
                      className="w-24 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-[11px] text-zinc-900 dark:text-white"
                    />
                  </div>
                </div>

                {run.audioFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {run.audioFiles.map((file) => (
                      <audio key={file} controls src={`/aggregator${file}`} className="w-full h-9" />
                    ))}
                  </div>
                )}

                {run.error && <p className="mt-2 text-[11px] text-red-400">{run.error}</p>}

                {run.breakdown?.components && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-zinc-500 dark:text-zinc-400 cursor-pointer">score breakdown</summary>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-zinc-400">
                      {Object.entries(run.breakdown.components).map(([key, value]) => (
                        <span key={key} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-white/5">
                          {key} {score(Number(value))}
                        </span>
                      ))}
                    </div>
                    {run.breakdown.notes && (
                      <ul className="mt-1 space-y-0.5">
                        {run.breakdown.notes.map((note) => (
                          <li key={note} className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {note}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                )}
              </div>
            ))}
            {runs.length === 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No renders yet - pick a design above and press Render.
              </p>
            )}
          </div>
        </section>
      </div>

      {reportText !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setReportText(null)}
        >
          <div
            className="max-w-3xl w-full max-h-[80vh] overflow-auto rounded-2xl bg-zinc-900 border border-white/10 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Market report</h3>
              <button
                onClick={() => setReportText(null)}
                className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200"
              >
                Close
              </button>
            </div>
            <pre className="text-[11px] leading-5 text-zinc-300 whitespace-pre-wrap">{reportText}</pre>
          </div>
        </div>
      )}
    </div>
  );
};