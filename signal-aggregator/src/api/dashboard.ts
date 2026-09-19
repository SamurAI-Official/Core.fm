/**
 * Dashboard: market trend cards, generated concepts and the human rating queue.
 * Deliberately framework-free (HTML string + fetch calls) so it adds no build
 * step and mirrors the CDN-Tailwind approach used by ace-step-ui.
 */

const HEAD = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Signal Aggregator - Music Trends by Nation</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 font-sans">
  <div class="max-w-7xl mx-auto p-6">
    <header class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Signal Aggregator</h1>
        <p class="text-sm text-zinc-400">Music trends by nation &rarr; song design &rarr; generation &rarr; market test &rarr; repeat</p>
      </div>
      <div class="flex gap-2 text-sm">
        <button id="btn-collect" class="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700">Collect signals</button>
        <button id="btn-design" class="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700">Design concepts</button>
        <button id="btn-cycle" class="px-3 py-2 rounded bg-pink-700 hover:bg-pink-600">Run one cycle</button>
      </div>
    </header>
    <div id="status" class="mb-4 text-sm text-amber-300"></div>
    <section class="mb-8">
      <h2 class="text-lg font-semibold mb-3">Markets</h2>
      <div id="markets" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"></div>
    </section>
    <section class="mb-8">
      <h2 class="text-lg font-semibold mb-3">Rating queue <span class="text-sm text-zinc-400">(human ratings drive the learning loop)</span></h2>
      <div id="queue" class="space-y-3"></div>
    </section>
    <section>
      <h2 class="text-lg font-semibold mb-3">Latest runs</h2>
      <div id="runs" class="space-y-2"></div>
    </section>
  </div>
`;

const SCRIPT = `<script>
const statusEl = document.getElementById('status');
const setStatus = (text) => { statusEl.textContent = text || ''; };
const pct = (v) => Math.round((v || 0) * 100) + '%';
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const audioFor = (run) => (run.audioUrls || [])
  .map((url) => '<audio class="w-full mt-2" controls src="' + esc(url) + '"></audio>').join('');

function marketCard(m) {
  const genres = (m.topGenres || []).map((g) =>
    '<li class="flex items-center gap-2"><span class="w-28 truncate text-zinc-300">' + esc(g.genre) + '</span>' +
    '<span class="flex-1 h-2 bg-zinc-800 rounded"><span class="block h-2 bg-pink-600 rounded" style="width:' +
    Math.min(100, g.share * 300) + '%"></span></span>' +
    '<span class="w-10 text-right text-zinc-400">' + pct(g.share) + '</span></li>').join('');
  return '<article class="bg-zinc-900 border border-zinc-800 rounded-lg p-4">' +
    '<div class="flex items-baseline justify-between"><h3 class="font-semibold">' + esc(m.name) +
    ' <span class="text-zinc-500 text-sm">' + esc(m.market) + '</span></h3>' +
    '<span class="text-xs text-zinc-400">conf ' + (m.confidence || 0).toFixed(2) + '</span></div>' +
    '<p class="text-xs text-zinc-400 mt-1">' + m.trackCount + ' signals &middot; ' + (m.bpm || '-') + ' BPM (' +
    esc(m.tempoClass) + '/' + esc(m.tempoSource) + ') &middot; ~' + m.durationMedian + 's &middot; ' +
    esc((m.languages || []).join('/')) + '</p>' +
    '<ul class="mt-3 space-y-1 text-xs">' + (genres || '<li class="text-zinc-500">no signals yet</li>') + '</ul>' +
    '<p class="text-xs text-zinc-400 mt-3">churn ' + pct(1 - (m.overlapRatio || 0)) + ' &middot; ' +
    m.newEntries + ' new entries</p>' +
    '<p class="text-xs text-zinc-500 mt-1">' + esc((m.chartLeaders || []).join(' / ')) + '</p>' +
    '<p class="text-xs text-zinc-400 mt-3">' + m.concepts + ' designs &middot; ' + m.runs + ' runs &middot; ' +
    m.rated + ' rated' + (m.bestComposite === null ? '' : ' &middot; best ' + m.bestComposite.toFixed(2)) + '</p>' +
    '<a class="text-xs text-pink-400 hover:underline mt-2 inline-block" target="_blank" href="/api/report/market/' +
    esc(m.market) + '">text report</a></article>';
}
function queueItem(run) {
  const buttons = [0.2, 0.4, 0.6, 0.8, 1].map((score) =>
    '<button class="rate px-2 py-1 rounded bg-zinc-800 hover:bg-pink-700 text-xs" data-run="' + esc(run.id) +
    '" data-score="' + score + '">' + score + '</button>').join('');
  return '<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-3">' +
    '<div class="flex flex-wrap items-center justify-between gap-2"><div class="text-sm">' +
    esc(run.market.toUpperCase()) + ' &middot; ' + esc(run.id.slice(0, 8)) +
    ' <span class="text-zinc-400">fit ' + run.marketFit + ' / nov ' + run.novelty + ' / comp ' + run.composite +
    '</span></div><div class="flex gap-1">' + buttons + '</div></div>' + audioFor(run) + '</div>';
}

function runRow(run) {
  return '<div class="bg-zinc-900 border border-zinc-800 rounded p-3 text-sm">' +
    '<div class="flex flex-wrap justify-between gap-2"><span>' + esc(run.market.toUpperCase()) + ' &middot; ' +
    esc(run.status) + ' &middot; ' + esc(run.verdict || '-') + '</span><span class="text-zinc-400">fit ' +
    run.marketFit + ' / nov ' + run.novelty + ' / comp ' + run.composite +
    (run.humanScore === null ? ' / unrated' : ' / human ' + run.humanScore) + '</span></div>' + audioFor(run) +
    (run.error ? '<p class="text-xs text-red-400 mt-1">' + esc(run.error) + '</p>' : '') + '</div>';
}

async function load() {
  const [overview, queue, runs] = await Promise.all([
    fetch('/api/overview').then((r) => r.json()),
    fetch('/api/rating-queue?limit=6').then((r) => r.json()),
    fetch('/api/runs?limit=10').then((r) => r.json()),
  ]);
  document.getElementById('markets').innerHTML = overview.markets.map(marketCard).join('');
  document.getElementById('queue').innerHTML = queue.runs.length
    ? queue.runs.map(queueItem).join('')
    : '<p class="text-sm text-zinc-500">Nothing to rate yet - render a concept first.</p>';
  document.getElementById('runs').innerHTML = runs.runs.length
    ? runs.runs.map(runRow).join('')
    : '<p class="text-sm text-zinc-500">No runs yet.</p>';
}

const ACTIONS = {
  'btn-collect': { path: 'collect', body: {}, busy: 'collecting signals from public charts...',
    done: (r) => 'collected ' + (r.totalTracks || 0) + ' signals, ' + (r.enriched || 0) + ' enriched, ' + (r.errors || 0) + ' source errors' },
  'btn-design': { path: 'design', body: {}, busy: 'designing concepts...',
    done: (r) => 'designed ' + (r.designed || 0) + ' concepts' },
  'btn-cycle': { path: 'cycle', body: { generateLimit: 2, enrichTop: 10 },
    busy: 'running one cycle (collect + design + render); this can take several minutes...',
    done: (r) => 'cycle ' + String(r.cycleId || '').slice(0, 8) + ': ' + (r.concepts || []).length + ' designed, ' + (r.executions || []).length + ' rendered' },
};

async function post(path, body) {
  const response = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.classList.contains('rate')) {
    setStatus('recording rating (re-scores the run and updates market weights)...');
    const result = await post('ratings', { runId: target.dataset.run, score: Number(target.dataset.score) });
    setStatus(result.error
      ? 'error: ' + result.error
      : 'rated ' + String(result.runId).slice(0, 8) + ' -> composite ' + result.composite + ' (' + result.verdict + ')' +
        (result.learning && result.learning.length ? ' | learned: ' + result.learning.join(', ') : ''));
    load();
    return;
  }

  const action = ACTIONS[target.id];
  if (!action) return;
  setStatus(action.busy);
  const result = await post(action.path, action.body);
  setStatus(result.error ? 'error: ' + result.error : action.done(result));
  load();
});

load();
</script>
</body>
</html>`;

export function dashboardHtml(): string {
  return `${HEAD}${SCRIPT}`;
}