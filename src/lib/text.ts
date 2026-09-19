/**
 * Script-aware text utilities.
 *
 * Every function here has to work for any script, because both the trend pipeline
 * and the lyric validator run over charts written in the market's own script
 * ("わたがし", "怪獣の花唄", "Шадэ", "我不难过"). The earlier helpers were
 * ASCII-only: `tokenize` replaced everything outside `[a-z0-9]` with a space, so a
 * Japanese title produced *zero* tokens. That silently broke three things at once -
 * theme extraction (briefs lost their "recurring themes"), novelty scoring, and
 * Deezer BPM matching (jaccard of an empty token set is 0, so every candidate was
 * rejected). All three reported confident-looking zeros rather than failing loudly,
 * which is why this lives in one place now.
 */

export type ScriptFamily =
  | 'latin'
  | 'cyrillic'
  | 'japanese'
  | 'hangul'
  | 'han'
  | 'devanagari'
  | 'arabic';

/**
 * Script detection patterns.
 *
 * Unicode *script properties*, not code-point ranges: a range like
 * `[\u0041-\u024F]` looks like "Latin" but also contains `[`, `]`, `\`, `^` and the
 * Latin-1 punctuation block, which once counted `[Chorus]`'s brackets as letters.
 */
export const SCRIPT_PATTERNS: Record<ScriptFamily, RegExp> = {
  latin: /\p{Script=Latin}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  hangul: /\p{Script=Hangul}/gu,
  han: /\p{Script=Han}/gu,
  devanagari: /\p{Script=Devanagari}/gu,
  arabic: /\p{Script=Arabic}/gu,
};

const LETTER = /\p{L}/gu;

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** True for scripts that do not delimit words with spaces. */
export function isNoSpaceScript(script: ScriptFamily): boolean {
  return script === 'japanese' || script === 'han';
}

/** Kana, tracked separately: kanji alone cannot distinguish Japanese from Chinese. */
const KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/**
 * Scripts scored for dominance.
 *
 * `japanese` is deliberately absent. Its pattern includes Han, so scoring it
 * alongside `han` counted the same characters twice - inflating the denominator and
 * pushing Han-only text to exactly 0.5, below the threshold, so "我不难过" was
 * reported as 'mixed' rather than Chinese.
 */
const DOMINANCE_SCRIPTS: ScriptFamily[] = ['latin', 'cyrillic', 'hangul', 'han', 'devanagari', 'arabic'];

/**
 * Best-guess script of a string.
 *
 * Kana presence wins outright, since kanji alone is ambiguous. Otherwise the
 * dominant non-overlapping script is used, and text with no clear majority is
 * reported as 'mixed' - which usually means a broken template.
 */
export function detectScript(text: string): ScriptFamily | 'mixed' {
  if (countMatches(text, KANA_PATTERN) > 0) return 'japanese';

  const scores = DOMINANCE_SCRIPTS.map(
    (script) => [script, countMatches(text, SCRIPT_PATTERNS[script])] as [ScriptFamily, number],
  );
  const letters = scores.reduce((sum, [, value]) => sum + value, 0);
  if (letters === 0) return 'latin';

  scores.sort((a, b) => b[1] - a[1]);
  const [top, topCount] = scores[0];
  return topCount / letters >= 0.6 ? top : 'mixed';
}

/** Letters in the text that belong to the given script, as a 0..1 share. */
export function scriptShare(text: string, script: ScriptFamily): number {
  const letters = countMatches(text, LETTER);
  if (letters === 0) return 1;
  const matched = countMatches(text, SCRIPT_PATTERNS[script]);
  return Math.min(1, matched / letters);
}

/**
 * Function words per language, used to strip grammar before theme extraction.
 *
 * The sets are applied as a *union* rather than by detecting the language first:
 * dropping a function word costs almost nothing, while failing to drop one ranks
 * "the" or "の" as a recurring theme.
 */
const STOPWORDS: Record<string, string[]> = {
  en: ['the','and','or','of','to','in','on','for','with','from','feat','ft','my','your','you','me','it','is','be','at','by','as','that','this','no','not','all','so','if','up','out','but','been','was','are'],
  fr: ['le','la','les','un','une','des','du','et','ou','au','aux','dans','sur','pour','avec','que','qui','pas','je','tu','il','elle','nous','vous','ils','ce','cette','mon','ma','mes','ton','ta','ses','son','sa','est','sont','cest'],
  de: ['der','die','das','den','dem','des','ein','eine','einen','und','oder','aber','nicht','kein','keine','ich','du','er','sie','wir','ihr','mein','dein','sein','ist','sind','war','mit','von','zum','zur','auf','im','am','fur','für','über','bei','aus','dass','wenn','wie','nur','noch','man'],
  es: ['los','las','unos','unas','del','con','por','para','que','si','mi','tu','su','nos','les','este','esto','como','mas','más','pero','ya'],
  it: ['gli','uno','una','del','della','dei','degli','delle','ed','od','alla','nel','nella','che','chi','non','ci','vi','mio','tua','suo','sono','come','piu','più'],
  pt: ['os','as','uma','uns','umas','do','da','dos','das','ou','no','na','nos','nas','com','para','que','nao','não','lhe','ele','ela','você','voce','meu','minha','seu','sua','sao','são','esta','como','mais','mas'],
  ru: ['что','как','все','она','так','его','только','мне','было','вот','меня','еще','нет','ему','теперь','когда','даже','вдруг','если','уже','или','быть','был','него','вас','опять','вам','ведь','там','потом','себя','ничего','может','они','тут','где','есть','надо','ней','для','тебя','их','чем','была','сам','чтоб','без','будто','чего','раз','тоже','себе','под','будет','тогда','кто','этот','того','потому','этого','какой','совсем','ним','здесь','этом','один','почти','мой','тем','чтобы','нее','сейчас','были','куда','зачем','всех','никогда','можно','при','наконец','об','другой','хоть','после','над','больше','тот','через','эти','нас','про','всего','них','какая','много','разве','эту','моя','хорошо','свою','перед','иногда','лучше','чуть','том','нельзя','такой','более','всегда','конечно','всю','между'],
  ja: ['の','は','が','を','に','で','と','も','へ','や','か','よ','ね','な','だ','です','ます','した','する','ある','いる','こと','もの','それ','これ','あれ','そして','でも','から','まで','より','だけ','また','まだ','もう'],
  ko: ['은','는','이','가','을','를','에','의','와','과','도','로','으로','에서','하고','입니다','있다','하다','우리','그','저','것','잘','안','못','더','또','그리고','하지만'],
  zh: ['的','了','着','过','吗','呢','吧','啊','我','你','他','她','它','是','在','和','就','都','也','很','不','没','有','这','那','个','们','会','要','到','说','去','来','与','及','之','其','而','把','被','让','给','从','对','为'],
};

const ALL_STOPWORDS = new Set(Object.values(STOPWORDS).flat());

/** Scripts that do not delimit words with spaces, so runs must be split manually. */
const CJK_TEST = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CJK_OR_HANGUL_TEST = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Splits a CJK run into adjacent bigrams.
 * Single Han characters are far too common to carry theme signal ("日" appears in
 * countless titles), while bigrams behave much like words do in spaced languages.
 */
function cjkBigrams(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length <= 1) return chars;
  const tokens: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    tokens.push(chars[index] + chars[index + 1]);
  }
  return tokens;
}

/**
 * Token list for similarity and theme work.
 *
 * Latin/Cyrillic words are kept whole; CJK runs become bigrams. This is what makes
 * jaccard-based matching (novelty scoring, Deezer BPM lookup) work for charts that
 * are not written in Latin script - previously they produced zero tokens and
 * therefore a similarity of exactly 0, so every candidate was rejected.
 */
export function tokenizeText(input: string): string[] {
  if (!input) return [];
  const cleaned = input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const out: string[] = [];

  for (const run of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (!run) continue;
    if (CJK_TEST.test(run)) {
      out.push(...cjkBigrams(run));
      continue;
    }
    // Same threshold as the original Latin-only implementation.
    if (run.length < 3) continue;
    if (ALL_STOPWORDS.has(run)) continue;
    out.push(run);
  }
  return out;
}

/**
 * Content words for theme extraction and lyric ad-libs.
 *
 * The Latin rules are deliberately unchanged - they are what keeps chart junk
 * ("GTAVI", "Track 2") out of lyrics. Non-Latin scripts get their own rules,
 * because requiring a 4-character token containing an ASCII vowel rejects every
 * Japanese and Chinese title ever written.
 */
export function contentTokensText(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];

  for (const part of raw.split(/[^\p{L}\p{N}']+/u)) {
    if (!part) continue;

    // CJK / Hangul: a token is rejected only when every character is a function
    // character, since length heuristics tuned for Latin do not apply here.
    if (CJK_OR_HANGUL_TEST.test(part)) {
      const chars = Array.from(part);
      if (chars.every((ch) => ALL_STOPWORDS.has(ch))) continue;
      out.push(chars.length === 1 ? chars[0] : part);
      continue;
    }

    const lower = part.toLowerCase();

    if (/\p{Script=Latin}/u.test(part)) {
      if (lower.length < 4 || lower.length > 18) continue;
      if (/^[A-Z0-9]{3,}$/.test(part)) continue; // acronym / brand styling
      if (/\d/.test(part)) continue; // years and numbered titles
      if (!/[aeiou]/.test(lower)) continue;
      if (ALL_STOPWORDS.has(lower)) continue;
      out.push(lower);
      continue;
    }

    // Other scripts (Cyrillic, Devanagari, Arabic...): real words only, no digits,
    // no short function words.
    if (lower.length < 3 || lower.length > 24) continue;
    if (/\d/.test(part)) continue;
    if (ALL_STOPWORDS.has(lower)) continue;
    out.push(lower);
  }
  return out;
}

/** True when the text contains any CJK or Hangul characters. */
export function containsCjk(text: string): boolean {
  return CJK_OR_HANGUL_TEST.test(text);
}

/** Exposed for tests and diagnostics. */
export function stopwordCount(): number {
  return ALL_STOPWORDS.size;
}
