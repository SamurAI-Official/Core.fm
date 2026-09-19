/**
 * Market catalog: Apple Music storefront country codes (ISO 3166-1 alpha-2)
 * enriched with the vocal language(s) and region each market is served in.
 * Only the code list drives collection; this metadata supplies the context used
 * when building market briefs and designing market-specific songs.
 */
export interface MarketInfo {
  /** English label used in reports. */
  name: string;
  /** Primary vocal language for the market (ISO 639-1). */
  language: string;
  /** Secondary languages the market broadly accepts. */
  secondaryLanguages?: string[];
  region: string;
}

export const MARKET_CATALOG: Record<string, MarketInfo> = {
  us: { name: 'United States', language: 'en', region: 'North America' },
  ca: { name: 'Canada', language: 'en', secondaryLanguages: ['fr'], region: 'North America' },
  mx: { name: 'Mexico', language: 'es', region: 'Latin America' },
  br: { name: 'Brazil', language: 'pt', region: 'Latin America' },
  ar: { name: 'Argentina', language: 'es', region: 'Latin America' },
  co: { name: 'Colombia', language: 'es', region: 'Latin America' },
  gb: { name: 'United Kingdom', language: 'en', region: 'Europe' },
  ie: { name: 'Ireland', language: 'en', region: 'Europe' },
  fr: { name: 'France', language: 'fr', region: 'Europe' },
  de: { name: 'Germany', language: 'de', region: 'Europe' },
  at: { name: 'Austria', language: 'de', region: 'Europe' },
  ch: { name: 'Switzerland', language: 'de', secondaryLanguages: ['fr', 'it'], region: 'Europe' },
  es: { name: 'Spain', language: 'es', region: 'Europe' },
  it: { name: 'Italy', language: 'it', region: 'Europe' },
  pt: { name: 'Portugal', language: 'pt', region: 'Europe' },
  nl: { name: 'Netherlands', language: 'nl', region: 'Europe' },
  se: { name: 'Sweden', language: 'sv', region: 'Europe' },
  no: { name: 'Norway', language: 'no', region: 'Europe' },
  dk: { name: 'Denmark', language: 'da', region: 'Europe' },
  fi: { name: 'Finland', language: 'fi', region: 'Europe' },
  pl: { name: 'Poland', language: 'pl', region: 'Europe' },
  gr: { name: 'Greece', language: 'el', region: 'Europe' },
  tr: { name: 'Turkey', language: 'tr', region: 'Europe' },
  ru: { name: 'Russia', language: 'ru', region: 'Europe' },
  jp: { name: 'Japan', language: 'ja', region: 'Asia' },
  kr: { name: 'South Korea', language: 'ko', region: 'Asia' },
  cn: { name: 'China', language: 'zh', region: 'Asia' },
  tw: { name: 'Taiwan', language: 'zh', region: 'Asia' },
  hk: { name: 'Hong Kong', language: 'zh', region: 'Asia' },
  th: { name: 'Thailand', language: 'th', region: 'Asia' },
  vn: { name: 'Vietnam', language: 'vi', region: 'Asia' },
  id: { name: 'Indonesia', language: 'id', region: 'Asia' },
  my: { name: 'Malaysia', language: 'ms', region: 'Asia' },
  ph: { name: 'Philippines', language: 'tl', secondaryLanguages: ['en'], region: 'Asia' },
  in: { name: 'India', language: 'hi', secondaryLanguages: ['ta', 'en'], region: 'Asia' },
  pk: { name: 'Pakistan', language: 'ur', region: 'Asia' },
  sa: { name: 'Saudi Arabia', language: 'ar', region: 'Middle East' },
  ae: { name: 'United Arab Emirates', language: 'ar', region: 'Middle East' },
  il: { name: 'Israel', language: 'he', region: 'Middle East' },
  eg: { name: 'Egypt', language: 'ar', region: 'Africa' },
  ng: { name: 'Nigeria', language: 'en', secondaryLanguages: ['yo', 'ig'], region: 'Africa' },
  za: { name: 'South Africa', language: 'en', secondaryLanguages: ['zu'], region: 'Africa' },
  ke: { name: 'Kenya', language: 'sw', secondaryLanguages: ['en'], region: 'Africa' },
  gh: { name: 'Ghana', language: 'en', region: 'Africa' },
  au: { name: 'Australia', language: 'en', region: 'Oceania' },
  nz: { name: 'New Zealand', language: 'en', region: 'Oceania' },
};

export const DEFAULT_MARKETS = ['us', 'gb', 'fr', 'de', 'br', 'jp', 'in', 'ng'];

export function marketInfo(cc: string): MarketInfo {
  return MARKET_CATALOG[cc] ?? { name: cc.toUpperCase(), language: 'en', region: 'Unknown' };
}
