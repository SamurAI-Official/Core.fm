/**
 * Canonical genre -> ACE-Step style vocabulary.
 *
 * ACE-Step responds best to concrete, comma-separated English production tags,
 * so each canonical genre carries instrumentation, mood and production hints
 * that the designer composes into a single style prompt.
 */
export interface GenreStyle {
  tags: string[];
  instruments: string[];
  mood: string[];
  /** 0..1 - how high energy the genre typically is (used for lyric/structure choice). */
  energy: number;
}

export const GENRE_STYLE: Record<string, GenreStyle> = {
  pop: { tags: ['radio pop', 'bright production', 'polished mix', 'hook-driven'], instruments: ['synth keys', 'punchy drums', 'bass'], mood: ['uplifting', 'catchy'], energy: 0.7 },
  hip_hop_rap: { tags: ['hip hop', 'boom bap influence', 'confident flow'], instruments: ['808 bass', 'crisp snares', 'vinyl texture'], mood: ['confident', 'gritty'], energy: 0.65 },
  trap: { tags: ['trap', 'rolling hi-hats', 'dark atmosphere'], instruments: ['sub bass', '808s', 'sparse keys'], mood: ['dark', 'hypnotic'], energy: 0.7 },
  r_and_b_soul: { tags: ['contemporary R&B', 'smooth groove', 'layered harmonies'], instruments: ['electric piano', 'soft drums', 'warm bass'], mood: ['sultry', 'intimate'], energy: 0.45 },
  rock: { tags: ['rock', 'live band energy', 'driving guitars'], instruments: ['electric guitars', 'live drums', 'bass'], mood: ['anthemic', 'raw'], energy: 0.85 },
  metal: { tags: ['metal', 'heavy riffs', 'double kick'], instruments: ['distorted guitars', 'aggressive drums'], mood: ['fierce', 'intense'], energy: 0.95 },
  punk: { tags: ['punk', 'fast and loose', 'shouted hooks'], instruments: ['power chords', 'fast drums'], mood: ['rebellious'], energy: 0.9 },
  indie_alt: { tags: ['indie alternative', 'textured guitars', 'intimate vocals'], instruments: ['jangly guitar', 'warm bass', 'live drums'], mood: ['reflective', 'wistful'], energy: 0.6 },
  electronic_dance: { tags: ['dance', 'festival energy', 'sidechained synths'], instruments: ['supersaw synths', 'four-on-the-floor kick'], mood: ['euphoric'], energy: 0.9 },
  house_techno: { tags: ['house', 'hypnotic groove', 'club mix'], instruments: ['analog bass', 'claps', 'pads'], mood: ['driving', 'nocturnal'], energy: 0.85 },
  ambient_chill: { tags: ['ambient', 'chill', 'spacious reverb'], instruments: ['pads', 'soft piano', 'textures'], mood: ['calm', 'dreamy'], energy: 0.2 },
  latin: { tags: ['latin pop', 'warm rhythms'], instruments: ['nylon guitar', 'congas', 'brass'], mood: ['sunny', 'romantic'], energy: 0.7 },
  reggaeton: { tags: ['reggaeton', 'dembow rhythm', 'bouncy bass'], instruments: ['dembow drums', 'synth bass'], mood: ['flirty', 'club-ready'], energy: 0.8 },
  country: { tags: ['country', 'storytelling', 'acoustic warmth'], instruments: ['acoustic guitar', 'pedal steel', 'brushed drums'], mood: ['heartfelt'], energy: 0.55 },
  folk_americana: { tags: ['folk', 'hand-played', 'close-mic vocals'], instruments: ['acoustic guitar', 'fiddle', 'upright bass'], mood: ['earnest'], energy: 0.4 },
  jazz: { tags: ['jazz', 'swung feel', 'improvised lines'], instruments: ['upright bass', 'brushed kit', 'saxophone'], mood: ['smoky'], energy: 0.4 },
  blues: { tags: ['blues', 'slow burn', 'call and response'], instruments: ['electric guitar', 'harmonica'], mood: ['weary'], energy: 0.5 },
  classical: { tags: ['orchestral', 'chamber arrangement'], instruments: ['strings', 'piano', 'timpani'], mood: ['cinematic'], energy: 0.35 },
  soundtrack: { tags: ['cinematic score', 'wide dynamics'], instruments: ['strings', 'piano', 'hybrid percussion'], mood: ['epic'], energy: 0.5 },
  k_pop: { tags: ['K-pop', 'tight production', 'switch-up sections'], instruments: ['bright synths', 'trap drums', 'vocal stacks'], mood: ['bold', 'playful'], energy: 0.85 },
  j_pop: { tags: ['J-pop', 'melodic chorus', 'anime-opening energy'], instruments: ['bright guitars', 'synth leads'], mood: ['hopeful'], energy: 0.8 },
  city_pop: { tags: ['city pop', '80s sheen', 'lush chords'], instruments: ['chorus guitar', 'FM bass', 'electric piano'], mood: ['nostalgic', 'breezy'], energy: 0.55 },
  anime_vocaloid: { tags: ['anime theme', 'fast melodic lines'], instruments: ['synth lead', 'rock band', 'electronic drums'], mood: ['energetic'], energy: 0.9 },
  afrobeats: { tags: ['afrobeats', 'log drum groove', 'warm percussion'], instruments: ['log drums', 'shakers', 'warm bass'], mood: ['joyful', 'smooth'], energy: 0.7 },
  amapiano: { tags: ['amapiano', 'deep log drums', 'airy pads'], instruments: ['log drums', 'shakers', 'soft keys'], mood: ['hypnotic'], energy: 0.65 },
  reggae_dancehall: { tags: ['reggae', 'one-drop feel', 'skank guitar'], instruments: ['skank guitar', 'deep bass', 'organ'], mood: ['laid-back'], energy: 0.55 },
  soul_funk: { tags: ['funk', 'tight horn stabs', 'syncopated groove'], instruments: ['clavinet', 'horns', 'slap bass'], mood: ['swaggering'], energy: 0.8 },
  gospel_christian: { tags: ['gospel', 'choir harmonies', 'rising dynamics'], instruments: ['Hammond organ', 'piano', 'choir'], mood: ['triumphant'], energy: 0.7 },
  devotional: { tags: ['devotional', 'meditative repetition'], instruments: ['harmonium', 'tabla', 'bells'], mood: ['serene'], energy: 0.35 },
  regional_south_asian: { tags: ['South Asian pop', 'filmi strings', 'ornamented melody'], instruments: ['tabla', 'sitar', 'strings', 'dhol'], mood: ['romantic', 'sweeping'], energy: 0.7 },
  regional_latin: { tags: ['regional Latin', 'live conjunto feel'], instruments: ['accordion', 'requinto', 'tuba bass'], mood: ['heartfelt'], energy: 0.6 },
  regional_middle_east: { tags: ['Arabic pop', 'maqam-flavoured melody', 'ornamented vocal'], instruments: ['oud', 'qanun', 'darbuka', 'strings'], mood: ['yearning'], energy: 0.6 },
  regional_east_asia: { tags: ['East Asian pop ballad', 'sweeping chorus'], instruments: ['piano', 'strings', 'guzheng'], mood: ['tender'], energy: 0.5 },
  regional_europe: { tags: ['European pop', 'warm arrangement'], instruments: ['accordion', 'piano', 'strings'], mood: ['nostalgic'], energy: 0.55 },
  singer_songwriter: { tags: ['singer-songwriter', 'sparse arrangement', 'confessional'], instruments: ['acoustic guitar', 'piano'], mood: ['honest'], energy: 0.3 },
  holiday: { tags: ['holiday', 'festive warmth', 'singalong chorus'], instruments: ['sleigh bells', 'piano', 'strings'], mood: ['cheerful'], energy: 0.6 },
  kids_family: { tags: ['family friendly', 'playful', 'simple hooks'], instruments: ['glockenspiel', 'ukulele', 'hand claps'], mood: ['joyful'], energy: 0.6 },
  instrumental_newage: { tags: ['instrumental', 'flowing arrangement'], instruments: ['piano', 'strings', 'synth pads'], mood: ['serene'], energy: 0.25 },
  other: { tags: ['contemporary production', 'clear mix'], instruments: ['synth keys', 'drums', 'bass'], mood: ['engaging'], energy: 0.6 },
};
export function genreStyle(genre: string): GenreStyle {
  return GENRE_STYLE[genre] ?? GENRE_STYLE.other;
}

/** Top-`count` genres implied by a market's genre mix, weighted. */
export function audienceStyles(genreWeights: Record<string, number>, count = 3): string[] {
  return Object.entries(genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([genre]) => genre);
}