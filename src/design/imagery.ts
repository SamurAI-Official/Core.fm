/**
 * Concrete metaphor banks, grouped by genre family.
 *
 * The arc's "concrete metaphor" stage must be a physical, specific object rather
 * than an abstraction, and it should feel native to the market's leading genres -
 * a screen door reads country, a strobe reads dance, an umbrella on the train
 * reads J-pop. These are noun phrases used in object position, so they are safe
 * after "There's", "Still thinking about" and "and it's enough".
 */

const GENRE_FAMILY: Record<string, string> = {
  country: 'roots',
  folk_americana: 'roots',
  blues: 'roots',
  singer_songwriter: 'roots',
  hip_hop_rap: 'urban',
  trap: 'urban',
  r_and_b_soul: 'urban',
  soul_funk: 'urban',
  gospel_christian: 'urban',
  electronic_dance: 'club',
  house_techno: 'club',
  ambient_chill: 'club',
  rock: 'band',
  metal: 'band',
  punk: 'band',
  indie_alt: 'band',
  afrobeats: 'afro',
  amapiano: 'afro',
  reggae_dancehall: 'afro',
  k_pop: 'eastasia',
  j_pop: 'eastasia',
  city_pop: 'eastasia',
  anime_vocaloid: 'eastasia',
  regional_east_asia: 'eastasia',
  latin: 'latin',
  reggaeton: 'latin',
  regional_latin: 'latin',
  regional_south_asian: 'southasia',
  devotional: 'southasia',
  regional_middle_east: 'southasia',
  jazz: 'quiet',
  classical: 'quiet',
  soundtrack: 'quiet',
  instrumental_newage: 'quiet',
  regional_europe: 'europe',
  holiday: 'europe',
  kids_family: 'europe',
};

const METAPHORS: Record<string, string[]> = {
  roots: [
    "a screen door that won't close",
    'gas station coffee going cold',
    'your name in the dust on the dash',
    'a dog that waits by the gate',
    'a field that nobody mows',
  ],
  urban: [
    'a phone with a cracked screen',
    'cash folded in a shoe box',
    'streetlight coming through the blinds',
    'a chain with a broken clasp',
    'a voicemail I never played',
  ],
  club: [
    'a strobe that keeps the time',
    'bass coming up through the floor',
    "a screen that won't go dark",
    'a crowd that sings it back',
    'a taxi light two streets away',
  ],
  band: [
    'a string about to break',
    "a match that won't light",
    'an amp that hums all night',
    'a tape stuck on the same bar',
    'a van that starts on the third try',
  ],
  afro: [
    'shoes worn thin at the heel',
    'a kettle whistling at dawn',
    'a generator that always starts',
    'a party that ends at sunrise',
    'a wrapper folded into a ring',
  ],
  eastasia: [
    'an umbrella left on the train',
    'a cassette that still plays',
    'a bento untouched on the desk',
    'a platform with one light on',
    'a message typed and deleted',
  ],
  latin: [
    'a folded note in a pocket',
    'henna fading on the hand',
    'a bus ticket crumpled twice',
    'an empty chair at the table',
    'a doorbell nobody answers',
  ],
  southasia: [
    'a lamp left burning all night',
    'letters stacked by the door',
    'a ring that never got sized',
    'a train that leaves without me',
    'a photo faded at the corner',
  ],
  quiet: [
    'a window left open',
    'dust turning in a sunbeam',
    'a hall with the lights down',
    'rain finding the same gutter',
    'a clock that runs a little fast',
  ],
  europe: [
    'a kettle left on the boil',
    'a map folded the wrong way',
    'a bicycle leaning on the fence',
    'a balcony nobody sits on',
    'a coin in the same coat pocket',
  ],
  general: [
    'a door left open',
    'a phone that never rings',
    "a ticket for a train that's gone",
    'a key that no longer fits',
    'a bruise that never shows',
  ],
};

export function metaphorFamily(genre: string): string {
  return GENRE_FAMILY[genre] ?? 'general';
}

/** Metaphor bank for a genre, widened with the general bank for variety. */
export function metaphorsFor(genre: string): string[] {
  const family = metaphorFamily(genre);
  const primary = METAPHORS[family] ?? METAPHORS.general;
  return family === 'general' ? primary : [...primary, ...METAPHORS.general.slice(0, 2)];
}