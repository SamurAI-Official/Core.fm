/**
 * Genre normalization across nations.
 *
 * Apple Music storefronts return genres in the local language (e.g. "ロック",
 * "Música", "Musique", "ヒップホップ／ラップ"). Comparing markets requires mapping
 * those onto one canonical taxonomy. Unmatched values are preserved as raw data
 * (the `genres` column) and bucketed as `other` for distributions.
 */

export interface CanonicalGenreRule {
  canonical: string;
  aliases: string[];
}

/** Umbrella/root labels that carry no genre information. */
const UMBRELLA = new Set([
  'music', 'musique', 'musik', 'música', 'musica', 'muziek', 'muzik', 'музыка', 'музика',
  'müzik', 'μουσική', 'מוזיקה', 'संगीत', 'موسيقى', 'ミュージック', '音楽', '音乐', '音樂',
  '음악', 'nhạc', 'เพลง',
]);

const RULES: CanonicalGenreRule[] = [
  { canonical: 'pop', aliases: ['pop', 'ポップ', '팝', 'поп', 'पॉप', '流行'] },
  { canonical: 'hip_hop_rap', aliases: ['hip hop', 'hip-hop', 'rap', 'ヒップホップ', 'ラップ', '힙합', '嘻哈', 'рэп', 'хип-хоп', 'रैप', 'grime', 'drill'] },
  { canonical: 'trap', aliases: ['trap', 'トラップ', '트랩', 'трэп'] },
  { canonical: 'r_and_b_soul', aliases: ['r&b', 'rnb', 'r and b', 'soul', 'ソウル', 'ритм-энд-блюз'] },
  { canonical: 'rock', aliases: ['rock', 'ロック', '록', 'рок', '摇滚', '搖滾'] },
  { canonical: 'metal', aliases: ['metal', 'メタル', '메탈', 'метал'] },
  { canonical: 'punk', aliases: ['punk', 'パンク', '펑크', 'панк'] },
  { canonical: 'indie_alt', aliases: ['alternative', 'indie', 'オルタナティブ', 'インディ', '인디', 'альтернатива', '独立'] },
  { canonical: 'electronic_dance', aliases: ['electronic', 'electronica', 'dance', 'edm', 'エレクトロニック', 'エレクトロ', '일렉트로닉', 'электронная', 'электроника', '电子', 'electro'] },
  { canonical: 'house_techno', aliases: ['house', 'techno', 'ハウス', 'テクノ', '하우스', '테크노', 'хаус', 'техно'] },
  { canonical: 'ambient_chill', aliases: ['ambient', 'chill', 'lounge', 'easy listening', 'アンビエント', 'イージーリスニング', 'эмбиент', 'lo-fi', 'lofi'] },
  { canonical: 'latin', aliases: ['latin', 'latina', 'latino', 'música latina', 'musica latina', 'латиноамериканская', 'ラテン'] },
  { canonical: 'reggaeton', aliases: ['reggaeton', 'reggaetón', 'レゲトン', '레게톤', 'реггетон'] },
  { canonical: 'country', aliases: ['country', 'música country', 'кантри', 'カントリー', '컨트리'] },
  { canonical: 'folk_americana', aliases: ['folk', 'americana', 'フォーク', '포크', 'фолк', '民謡'] },
  { canonical: 'jazz', aliases: ['jazz', 'ジャズ', '재즈', 'джаз', '爵士'] },
  { canonical: 'blues', aliases: ['blues', 'ブルース', '블루스', 'блюз'] },
  { canonical: 'classical', aliases: ['classical', 'クラシック', 'クラシカル', '클래식', 'классика', '古典', 'música clásica', 'orchestral'] },
  { canonical: 'soundtrack', aliases: ['soundtrack', 'サウンドトラック', '사운드트랙', 'саундтрек', '原声', 'score', 'musical', 'ミュージカル'] },
  { canonical: 'k_pop', aliases: ['k-pop', 'kpop', 'ケーポップ', '케이팝'] },
  { canonical: 'j_pop', aliases: ['j-pop', 'jpop', 'ジェイポップ', '邦楽', '歌謡曲', 'ジャパニーズ'] },
  { canonical: 'city_pop', aliases: ['city pop', 'シティポップ', '시티팝'] },
  { canonical: 'anime_vocaloid', aliases: ['anime', 'アニメ', '애니메이션', 'ボカロ', 'vocaloid', 'ボーカロイド'] },
  { canonical: 'afrobeats', aliases: ['afrobeats', 'afrobeat', 'afro pop', 'afro-pop', 'afropop', 'アフロビーツ', 'афробит'] },
  { canonical: 'amapiano', aliases: ['amapiano', 'アマピアノ'] },
  { canonical: 'reggae_dancehall', aliases: ['reggae', 'dancehall', 'レゲエ', '레게', 'регги', 'ragga'] },
  { canonical: 'soul_funk', aliases: ['funk', 'ファンク', 'фанк', 'disco', 'ディスコ'] },
  { canonical: 'gospel_christian', aliases: ['gospel', 'christian', 'ゴスペル', 'クリスチャン', '크리스천', 'евангелие', 'worship', 'ワーシップ'] },
  { canonical: 'devotional', aliases: ['devotional', 'bhajan', 'バジャン', 'bhakti', 'sufi', 'スーフィー'] },
  { canonical: 'regional_south_asian', aliases: ['regional indian', 'indian', 'tamil', 'telugu', 'hindi', 'punjabi', 'bhangra', 'filmi', 'bollywood', 'desi', 'インド', 'インディアン', 'ヒンィー'] },
  { canonical: 'regional_latin', aliases: ['regional mexicano', 'sertaneja', 'sertanejo', 'forró', 'forro', 'pagode', 'samba', 'bossa nova', 'mpb', 'tango', 'cumbia', 'bachata', 'salsa', 'música regional', 'axe', 'axé'] },
  { canonical: 'regional_middle_east', aliases: ['arabic', 'música árabe', 'アラビア', 'アラブ', 'middle eastern', 'turkish', 'türk', 'arabesk', 'fantezi', 'türkçe', 'トルコ'] },
  { canonical: 'regional_east_asia', aliases: ['cantopop', 'mandopop', '粤语', '國語', '华语', 'カントポップ', 'マンドポップ', '演歌', 'enka', 'trot', 'トロット'] },
  { canonical: 'regional_europe', aliases: ['french chanson', 'chanson', 'シャンソン', 'variété', 'schlager', 'volksmusik', 'шансон'] },
  { canonical: 'singer_songwriter', aliases: ['singer/songwriter', 'singer-songwriter', 'cantautor', 'シンガーソングライター', 'авторская песня'] },
  { canonical: 'holiday', aliases: ['holiday', 'christmas', 'noël', 'noel', 'weihnachten', 'navidad', 'natal', 'クリスマス', '크리스마스', 'праздник', 'новогодн'] },
  { canonical: 'kids_family', aliases: ['kids', "children's music", 'children', 'キッズ', 'こども', '어린이', 'детск'] },
  { canonical: 'instrumental_newage', aliases: ['instrumental', 'インストゥルメンタル', '器楽', 'new age', 'ニューエイジ', 'инструментальная', 'neoclassical'] },
];

/** Normalized alias -> canonical lookup, built once (longest alias first). */
const ALIAS_INDEX: Array<[string, string]> = RULES.flatMap((rule) =>
  rule.aliases.map((alias) => [alias, rule.canonical] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

export const CANONICAL_GENRES: string[] = RULES.map((r) => r.canonical);

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[／|]/g, '/')
    .replace(/＆/g, '&')
    .replace(/[‐–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a composite genre label ("Hip-hop/Rap", "ヒップホップ／ラップ") into tokens. */
export function splitGenreTokens(raw: string): string[] {
  return normalizeToken(raw)
    .split(/[/,&;、，]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export interface GenreNormalization {
  raw: string[];
  canonical: string[];
  unmapped: string[];
}

/**
 * Maps raw (possibly localized) genre labels onto canonical keys.
 * Never throws away input: unmapped tokens are reported for later curation.
 */
export function normalizeGenres(rawGenres: Array<string | undefined | null>): GenreNormalization {
  const raw: string[] = [];
  const canonical = new Set<string>();
  const unmapped = new Set<string>();

  for (const value of rawGenres) {
    if (!value) continue;
    raw.push(String(value));
    for (const token of splitGenreTokens(String(value))) {
      if (UMBRELLA.has(token) || token.length < 3) continue;
      const exact = ALIAS_INDEX.find(([alias]) => alias === token);
      const partial = exact ?? ALIAS_INDEX.find(([alias]) => token.includes(alias));
      if (partial) {
        canonical.add(partial[1]);
      } else {
        unmapped.add(token);
      }
    }
  }

  return {
    raw,
    canonical: canonical.size > 0 ? Array.from(canonical) : ['other'],
    unmapped: Array.from(unmapped),
  };
}

/** Convenience wrapper returning only canonical keys (with `other` fallback). */
export function canonicalGenres(rawGenres: Array<string | undefined | null>): string[] {
  return normalizeGenres(rawGenres).canonical;
}