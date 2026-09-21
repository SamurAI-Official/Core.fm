/**
 * Subject catalog: *what a song is about*, as opposed to `arc.ts`, which is about
 * what a song's sections are doing.
 *
 * Why this exists: the banks alone told one story (midnight, staying or leaving,
 * ambivalence). `writeLyrics` accepted `themes` and `terms` but never read `themes`
 * and only used `terms` for a single English ad-lib, so every market, genre and
 * language produced the same subject with different wording. A generator that
 * cannot be about anything else is subject-constrained, however good its grammar is.
 *
 * The subject is therefore an explicit, reported choice:
 *
 *   - it is matched first from the market's *own* evidence - chart words and the
 *     market's flavour themes - so a market whose charts talk about family gets
 *     songs about family;
 *   - when nothing matches it is drawn from a seeded, rotating pick, so designs
 *     still vary instead of silently reverting to one subject;
 *   - it is recorded on the concept (`params.lyricSubject*`) and in the rationale,
 *     so a subject the writing pack could not realise is visible rather than implied.
 *
 * Matching is deliberately keyword-based rather than semantic: no embedding model,
 * no API key, and a run stays reproducible. The cost is that non-Latin charts
 * (Korean, Chinese, Japanese...) cannot be keyword-matched against these English
 * keywords - those markets rotate through the catalog instead, which is why
 * `exclude` rotation matters as much as matching does.
 */

export interface SubjectProfile {
  id: string;
  /** English label used in the rationale, the UI and run manifests. */
  label: string;
  /**
   * Chart words and theme phrases that point at this subject. Matching is
   * accent-insensitive and whole-word for single words ("part" must not fire on
   * "party"), and substring for multi-word phrases.
   */
  keywords: string[];
  /**
   * Imagery families (see `imagery.ts`) this subject prefers. The subject picks
   * from these when the RNG chooses subject-led imagery; otherwise the genre's own
   * family is used, so a screen door still reads country.
   */
  families: string[];
}

export const SUBJECTS: SubjectProfile[] = [
  {
    id: 'leaving-and-staying',
    label: 'leaving and staying',
    keywords: [
      'leave', 'leaves', 'leaving', 'left', 'stay', 'stays', 'staying', 'goodbye', 'gone', 'away',
      'door', 'porch', 'wait', 'waiting', 'hold', 'hold on', 'part', 'miss', 'missed', 'distance',
      'longing', 'distance and longing', 'connection', 'melancholy', 'urban romance',
      'late-night city life', 'late-night drive', 'gentle longing',
    ],
    families: ['general'],
  },
  {
    id: 'city-and-work',
    label: 'city life and work',
    keywords: [
      'city', 'downtown', 'street', 'streets', 'shift', 'work', 'job', 'money', 'rent', 'train',
      'commute', 'pressure', 'hustle', 'hustle and hope', 'ambition', 'confidence', 'self-belief',
      'resilience', 'nightlife', 'night out', 'city nights', 'city pressure', 'movement',
      'youth and ambition', 'late night',
    ],
    families: ['urban'],
  },
  {
    id: 'family-and-distance',
    label: 'family and distance from home',
    keywords: [
      'family', 'home', 'mother', 'father', 'brother', 'sister', 'grandmother', 'grandfather',
      'daughter', 'son', 'village', 'kitchen', 'community', 'belonging', 'romance', 'festival',
      'return', 'returning',
    ],
    families: ['roots'],
  },
  {
    id: 'celebration-and-hustle',
    label: 'celebration and hustle',
    keywords: [
      'party', 'dance', 'dancing', 'celebrate', 'celebration', 'tonight', 'crowd', 'vibe', 'summer',
      'sun', 'blessings', 'blessing', 'hope', 'joy', 'dance and celebration',
      'sun and sea', 'starting over',
    ],
    families: ['afro', 'club'],
  },
  {
    id: 'memory-and-loss',
    label: 'memory and loss',
    keywords: [
      'memory', 'memories', 'remember', 'yesterday', 'photograph', 'photo', 'letter', 'letters',
      'ghost', 'last', 'used', 'old', 'seasons', 'season', 'rain', 'seasons and memory',
      'nostalgia', 'saudade', 'devotion',
    ],
    families: ['quiet'],
  },
  {
    id: 'starting-over',
    label: 'starting over',
    keywords: [
      'new', 'again', 'begin', 'beginning', 'start', 'starting', 'tomorrow', 'road', 'highway',
      'drive', 'run', 'running', 'escape', 'open', 'freedom', 'second chances',
    ],
    families: ['europe', 'urban'],
  },
];

const PROFILES = new Map(SUBJECTS.map((profile) => [profile.id, profile]));

export function subjectIds(): string[] {
  return SUBJECTS.map((profile) => profile.id);
}

export function subjectProfile(id: string): SubjectProfile | undefined {
  return PROFILES.get(id);
}

export function subjectLabel(id: string): string {
  return PROFILES.get(id)?.label ?? id;
}


export interface SubjectChoice {
  id: string;
  label: string;
  /** `chart-topic` when the market's own words chose it, otherwise the fallback. */
  source: 'chart-topic' | 'rotation' | 'seeded';
  /** The chart word or theme phrase that matched, when there was one. */
  matched?: string;
}

/** Accent- and case-insensitive form, so "café" and "cafe" match alike. */
function normalise(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first haystack this keyword hits, or undefined. */
function hit(keyword: string, haystacks: string[]): string | undefined {
  const needle = normalise(keyword);
  if (!needle) return undefined;
  const wordBound = !needle.includes(' ');
  const pattern = wordBound ? new RegExp(`\\b${escapeRegExp(needle)}\\b`) : undefined;

  for (const hay of haystacks) {
    const text = normalise(hay);
    if (!text) continue;
    if (wordBound ? pattern!.test(text) : text.includes(needle)) return hay;
  }
  return undefined;
}

/**
 * Chooses the subject for one song.
 *
 * `only` restricts the pool to subjects the writing pack actually realises, so a
 * concept is never labelled with a subject the pack can only fall back on. `exclude`
 * carries subjects already used in this market (and earlier in the same design run);
 * exclusions are honoured only while they leave something to choose from, because a
 * design run must never fail for lack of a fresh subject.
 */
export function chooseSubject(options: {
  /** Chart words from the market brief (any script). */
  terms?: string[];
  /** Market flavour themes (English, from `marketFlavor.ts`). */
  themes?: string[];
  rng: () => number;
  /** Ids the pack realises. Empty/absent means "the whole catalog". */
  only?: string[];
  /** Ids to avoid: already used in this market, or already used in this run. */
  exclude?: string[];
  /**
   * Learned preference per subject id (the `subject:` market weights). A disliked subject is less
   * likely to win the draw, including when the chart would otherwise have matched it - which is what
   * makes a thumbs-down change the next design rather than only being recorded.
   */
  weights?: Record<string, number>;
}): SubjectChoice {
  const rng = options.rng;
  const weightFor = (id: string): number => {
    const raw = options.weights?.[id];
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(3, Math.max(0.25, raw)) : 1;
  };
  const pool = options.only && options.only.length > 0
    ? options.only
        .map((id) => PROFILES.get(id))
        .filter((profile): profile is SubjectProfile => Boolean(profile))
    : SUBJECTS;
  const candidates = pool.length > 0 ? pool : SUBJECTS;

  const excluded = new Set(options.exclude ?? []);
  const fresh = candidates.filter((profile) => !excluded.has(profile.id));
  const usable = fresh.length > 0 ? fresh : candidates;

  // Score every candidate against the market's own words; a total of zero falls
  // through to the seeded pick below.
  const sources = [...(options.terms ?? []), ...(options.themes ?? [])];
  const scored = usable.map((profile) => {
    let score = 0;
    let matched: string | undefined;
    for (const keyword of profile.keywords) {
      const found = hit(keyword, sources);
      if (found) {
        score += 1;
        matched = matched ?? found;
      }
    }
    return { profile, score: score * weightFor(profile.id), matched };
  });

  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  if (total > 0) {
    let roll = rng() * total;
    for (const entry of scored) {
      if (entry.score <= 0) continue;
      roll -= entry.score;
      if (roll <= 0) {
        return { id: entry.profile.id, label: entry.profile.label, source: 'chart-topic', matched: entry.matched };
      }
    }
    const best = scored.filter((entry) => entry.score > 0)[0];
    return { id: best.profile.id, label: best.profile.label, source: 'chart-topic', matched: best.matched };
  }

  // Nothing matched: rotate (or draw) rather than repeating, still weighted by preference so a
  // disliked subject does not come back simply because the chart said nothing about it.
  const weightedPool = usable.map((profile) => ({ profile, weight: weightFor(profile.id) }));
  const poolTotal = weightedPool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * poolTotal;
  let pick = usable[0];
  for (const entry of weightedPool) {
    roll -= entry.weight;
    if (roll <= 0) {
      pick = entry.profile;
      break;
    }
  }
  return {
    id: pick.id,
    label: pick.label,
    // `rotation` when something was deliberately held back from this market,
    // `seeded` when the pool was free to be drawn from in any order.
    source: fresh.length > 0 && excluded.size > 0 ? 'rotation' : 'seeded',
  };
}
