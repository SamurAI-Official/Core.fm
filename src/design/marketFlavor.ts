/**
 * Local flavour: production colour, vocal delivery notes and lyrical themes
 * that make a design feel native to a market rather than generic.
 *
 * Region entries provide a baseline; individual markets override or extend them.
 * These are descriptive hints for the style prompt and lyric writer - they are
 * deliberately conservative rather than stereotyping a market.
 */
import { marketInfo } from '../markets.js';

export interface MarketFlavor {
  /** Extra production/instrument tags that localise a track. */
  flavorTags: string[];
  /** Guidance for vocal delivery and language use. */
  vocalNotes: string;
  /** Lyrical motifs that tend to resonate locally. */
  themes: string[];
}

const REGION_FLAVOR: Record<string, MarketFlavor> = {
  'North America': {
    flavorTags: ['wide stereo mix', 'loud streaming master'],
    vocalNotes: 'clear lead vocal, layered backing harmonies on the hook',
    themes: ['late-night city life', 'resilience', 'self-belief'],
  },
  'Latin America': {
    flavorTags: ['percussive groove', 'warm low end'],
    vocalNotes: 'expressive lead vocal with rhythmic phrasing',
    themes: ['dance and celebration', 'longing', 'family'],
  },
  Europe: {
    flavorTags: ['clean production', 'tight arrangement'],
    vocalNotes: 'polished lead vocal, subtle doubles',
    themes: ['nostalgia', 'night out', 'connection'],
  },
  Asia: {
    flavorTags: ['detailed high-end', 'melodic detail'],
    vocalNotes: 'precise melodic delivery, expressive chorus',
    themes: ['youth and ambition', 'seasons and memory', 'belonging'],
  },
  'Middle East': {
    flavorTags: ['ornamented lead lines', 'rich strings'],
    vocalNotes: 'ornamented vocal lines with melismatic runs',
    themes: ['devotion', 'distance and longing'],
  },
  Africa: {
    flavorTags: ['live percussion layers', 'dance-forward groove'],
    vocalNotes: 'warm lead vocal with call-and-response hook',
    themes: ['celebration', 'hustle and hope', 'community'],
  },
  Oceania: {
    flavorTags: ['open-air mix', 'sunlit guitars'],
    vocalNotes: 'relaxed lead vocal, singalong chorus',
    themes: ['freedom', 'summer', 'starting over'],
  },
  Unknown: {
    flavorTags: ['balanced mix'],
    vocalNotes: 'clear lead vocal',
    themes: ['connection', 'movement'],
  },
};

const MARKET_FLAVOR: Record<string, Partial<MarketFlavor>> = {
  us: { flavorTags: ['streaming-ready master', 'wide drums'], themes: ['hustle', 'late-night drive', 'second chances'] },
  gb: { flavorTags: ['tight UK production', 'deep sub bass'], themes: ['nightlife', 'city pressure', 'resilience'] },
  ca: { flavorTags: ['clean guitars', 'bright chorus'] },
  fr: { flavorTags: ['French touch polish', 'filtered chords'], vocalNotes: 'French vocal delivery, understated verses', themes: ['urban romance', 'melancholy'] },
  de: { flavorTags: ['precise mix', 'analog warmth'], vocalNotes: 'German vocal delivery, crisp consonants', themes: ['freedom', 'movement'] },
  es: { flavorTags: ['sunset guitar', 'handclaps'] },
  it: { flavorTags: ['operatic lift on the chorus', 'warm strings'] },
  se: { flavorTags: ['Nordic pop sheen', 'glossy synths'] },
  nl: { flavorTags: ['dance-ready drums', 'tight low end'] },
  pl: { flavorTags: ['warm analogue keys', 'steady groove'] },
  tr: { flavorTags: ['anatolian melodic touches', 'live percussion'] },
  br: { flavorTags: ['baile-adjacent percussion', 'warm bass'], vocalNotes: 'Portuguese vocal delivery, relaxed flow', themes: ['sun and sea', 'saudade', 'celebration'] },
  mx: { flavorTags: ['requinto flourishes', 'live brass'] },
  ar: { flavorTags: ['cumbia-adjacent groove', 'bright accordion'] },
  jp: { flavorTags: ['city-pop chords', 'detailed synth work'], vocalNotes: 'Japanese vocal delivery, precise pitch on the chorus', themes: ['city nights', 'seasons', 'gentle longing'] },
  kr: { flavorTags: ['K-pop vocal layering', 'hard-hitting drop'], vocalNotes: 'Korean vocal delivery with stacked harmonies', themes: ['ambition', 'youth', 'confidence'] },
  cn: { flavorTags: ['mandopop balladry', 'sweeping strings'] },
  th: { flavorTags: ['bright plucked leads', 'tropical percussion'] },
  id: { flavorTags: ['dangdut-adjacent groove', 'lively percussion'] },
  in: { flavorTags: ['tabla groove', 'ornamented melodic hook'], vocalNotes: 'Hindi vocal delivery with light ornamentation', themes: ['romance', 'festival', 'family'] },
  pk: { flavorTags: ['qawwali-style dynamics', 'harmonium'] },
  ng: { flavorTags: ['afrobeats percussion', 'log drums', 'pidgin-friendly hooks'], vocalNotes: 'English/Pidgin delivery, relaxed melodic flow', themes: ['celebration', 'hustle', 'blessings'] },
  gh: { flavorTags: ['highlife guitar', 'live drums'] },
  za: { flavorTags: ['amapiano-adjacent groove', 'airy pads'] },
  ke: { flavorTags: ['benga guitar lines', 'warm percussion'] },
  eg: { flavorTags: ['maqam-tinted melody', 'string flourishes'] },
  sa: { flavorTags: ['oud accents', 'wide reverb'] },
  il: { flavorTags: ['Middle Eastern percussion', 'bright synth lead'] },
  au: { flavorTags: ['open guitars', 'big chorus'] },
  nz: { flavorTags: ['dreamy reverb', 'soft dynamics'] },
};

export function flavorFor(market: string): MarketFlavor {
  const info = marketInfo(market);
  const region = REGION_FLAVOR[info.region] ?? REGION_FLAVOR.Unknown;
  const override = MARKET_FLAVOR[market] ?? {};
  return {
    flavorTags: [...(override.flavorTags ?? []), ...region.flavorTags],
    vocalNotes: override.vocalNotes ?? region.vocalNotes,
    themes: override.themes ?? region.themes,
  };
}