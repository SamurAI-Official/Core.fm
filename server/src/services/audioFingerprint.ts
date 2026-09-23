/**
 * An audio fingerprint, and the comparison it makes possible.
 *
 * Why this exists: the gate that adopts a model edition needs to know whether the candidate's render of a
 * held-out prompt is closer to what the listener actually liked than the incumbent's render of the same
 * prompt. That is a *relative* question about two renders of one prompt, and answering it needs a distance
 * - not a quality judgement, which nothing here attempts.
 *
 * What it is: a compact spectral description of a file - band energies plus brightness and a roughness
 * measure, summarised as means and spreads over the track and L2-normalised - so two files can be compared
 * by cosine distance. The bands come from a Goertzel filter bank rather than a hand-written FFT: for band
 * energies that is the same answer with far fewer moving parts.
 *
 * What it deliberately is not: a measure of quality, or a substitute for listening. A distance like this can
 * be satisfied by blandness - the average of everything sits near the middle of it - which is why it only
 * ever *ranks two renders of the same prompt*, why adoption still requires the quality gates and a win rate,
 * and why the provenance of a decision (listened to, or measured) is recorded with it. Its honest use is as
 * a hypothesis that the listening test can check.
 *
 * Decoding is handed to ffmpeg, which this machine already has on PATH. That is a real dependency and it is
 * reported as one rather than failing silently: a missing ffmpeg means no measurement, not a zero distance.
 */
import { spawnSync } from 'node:child_process';

/** Bands are spaced logarithmically between these, which is where music's energy actually lives. */
const BAND_LOW_HZ = 60;
const BAND_HIGH_HZ = 8000;
const BAND_COUNT = 20;
/** ~46 ms frames at 22.05 kHz, half-overlapped: long enough for a pitch, short enough to move. */
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const ANALYSIS_RATE = 22050;
/** A track is summarised from at most this much audio, so a long render costs no more than a short one. */
const MAX_SECONDS = 90;

export interface Fingerprint {
  /** The feature vector, L2-normalised so cosine similarity is a plain dot product. */
  vector: number[];
  /** How many frames went into it, so a near-empty file is visible rather than silent. */
  frames: number;
  seconds: number;
}

/** Decodes a file to mono float samples at the analysis rate. Throws with the reason if it cannot. */
function decodeMono(file: string, seconds = MAX_SECONDS): Float32Array {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-t', String(seconds), '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'],
    { maxBuffer: 1024 * 1024 * 256, encoding: 'buffer' },
  );
  if (result.error) {
    throw new Error(
      `could not run ffmpeg (${(result.error as NodeJS.ErrnoException).code ?? 'unknown'}): it is required to ` +
        'decode renders for comparison, and a missing decoder must not read as a zero distance',
    );
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed on ${file}: ${String(result.stderr ?? '').split('\n')[0]}`);
  }
  const buffer = result.stdout as Buffer;
  if (buffer.length < FRAME_SIZE * 4) throw new Error(`${file} decoded to almost nothing`);
  // The buffer is a stream of little-endian f32; a copy is needed because its offset may not be aligned.
  const samples = new Float32Array(Math.floor(buffer.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(i * 4);
  return samples;
}

/** Band centre frequencies, spaced logarithmically. */
function bandCentres(): number[] {
  const centres: number[] = [];
  const ratio = (BAND_HIGH_HZ / BAND_LOW_HZ) ** (1 / (BAND_COUNT - 1));
  for (let i = 0; i < BAND_COUNT; i++) centres.push(BAND_LOW_HZ * ratio ** i);
  return centres;
}

/**
 * Energy at one frequency over one frame, by the Goertzel recurrence.
 *
 * Cheaper and simpler than a full transform when only a handful of frequencies matter, and it needs no
 * twiddle tables - the whole filter is two multiplications and an add per sample.
 */
function goertzel(frame: Float32Array, frequency: number, sampleRate: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < frame.length; i++) {
    const s0 = frame[i] + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coefficient * s1 * s2;
}

/** Zero crossings per sample - a cheap, honest roughness measure that survives downsampling. */
function zeroCrossingRate(frame: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) if (frame[i - 1] < 0 !== frame[i] < 0) crossings += 1;
  return crossings / frame.length;
}

/**
 * Fingerprints one file.
 *
 * The summary is mean and standard deviation per feature over all frames: the mean says what the track is
 * like, the spread says how much it moves. That matters because "closer to what you liked" should not
 * reward a render that is static where the liked material moved.
 */
export function fingerprintFile(file: string): Fingerprint {
  const samples = decodeMono(file);
  const centres = bandCentres();
  const frames = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  if (frames < 4) throw new Error(`${file} is too short to fingerprint (${frames} frame(s))`);

  const perFrame: number[][] = [];
  const frame = new Float32Array(FRAME_SIZE);
  for (let index = 0; index < frames; index++) {
    const start = index * HOP_SIZE;
    frame.set(samples.subarray(start, start + FRAME_SIZE));
    const energies = centres.map((centre) => goertzel(frame, centre, ANALYSIS_RATE));
    const total = energies.reduce((sum, value) => sum + value, 0) || 1;

    /**
     * Each frame is reduced to a *distribution over bands* before anything else, so the level cannot leak
     * into the fingerprint.
     *
     * This took two attempts. The first used `log1p(energy)`, which is level-sensitive: the same material at
     * a quarter of the volume scored 0.94 against itself, and a candidate edition could then have won a
     * comparison by being mastered louder instead of by being closer to what the listener liked. Dividing
     * by the frame's total energy removes the level exactly (every band scales by the same factor), and
     * taking the log afterwards is a monotone reshaping of a quantity that no longer contains it - the same
     * idea as dropping the zeroth cepstral coefficient.
     */
    const shape = energies.map((energy) => Math.log(energy / total + 1e-9));
    /**
     * The frame's own tilt is removed too, leaving structure *relative to* it.
     *
     * Every piece of music is louder in the low bands than the high ones, so the raw shape of any two
     * tracks points the same way - measured, two different real renders scored 0.99 similar and a tone and
     * pink noise scored 0.95, which is too blunt to decide anything. Subtracting each frame's mean leaves
     * where the peaks and valleys sit relative to that slope, and the slope itself is not lost: it is the
     * brightness feature below.
     */
    const tilt = shape.reduce((sum, value) => sum + value, 0) / shape.length;
    const detail = shape.map((value) => value - tilt);
    // Brightness: where the energy sits, from the linear energies - scale-invariant by construction.
    const centroid = energies.reduce((sum, energy, i) => sum + energy * centres[i], 0) / total;
    perFrame.push([...detail, centroid / BAND_HIGH_HZ, zeroCrossingRate(frame)]);
  }

  const features = perFrame[0].length;
  const vector: number[] = [];
  for (let f = 0; f < features; f++) {
    const values = perFrame.map((rowData) => rowData[f]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    vector.push(mean, Math.sqrt(variance));
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return { vector: vector.map((value) => value / norm), frames, seconds: samples.length / ANALYSIS_RATE };
}

/** Cosine similarity of two normalised fingerprints: 1 identical, 0 orthogonal. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  let dot = 0;
  for (let i = 0; i < a.vector.length && i < b.vector.length; i++) dot += a.vector[i] * b.vector[i];
  return dot;
}

/** The average of several fingerprints - what "the material this listener liked" looks like together. */
export function meanFingerprint(fingerprints: Fingerprint[]): Fingerprint {
  if (fingerprints.length === 0) throw new Error('no fingerprints to average');
  const length = fingerprints[0].vector.length;
  const vector = new Array(length).fill(0);
  for (const item of fingerprints) {
    for (let i = 0; i < length; i++) vector[i] += item.vector[i];
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return {
    vector: vector.map((value) => value / norm),
    frames: fingerprints.reduce((sum, item) => sum + item.frames, 0),
    seconds: fingerprints.reduce((sum, item) => sum + item.seconds, 0) / fingerprints.length,
  };
}

export interface RenderComparison {
  /** Which render is closer to the liked material, or 'tie' when the distances are within the margin. */
  winner: 'candidate' | 'incumbent' | 'tie';
  candidateSimilarity: number;
  incumbentSimilarity: number;
  /** The margin below which two distances are not distinguishable, in similarity units. */
  margin: number;
  detail: string;
}

/** Two renders closer than this are treated as the same: a difference smaller than the measurement. */
const TIE_MARGIN = 0.005;

/**
 * Which of two renders of one prompt is closer to what the listener liked.
 *
 * Deliberately a comparison and never an absolute score: an absolute number would have to mean "good", and
 * this cannot know that. Given the same reference material and two renders of the same prompt, it can say
 * which is nearer - and a difference smaller than `TIE_MARGIN` is reported as a tie, so measurement noise
 * cannot decide an adoption.
 */
export function compareRenders(input: {
  /** Files the listener liked on this prompt: the reference the two renders are compared against. */
  likedFiles: string[];
  candidateFile: string;
  incumbentFile: string;
  margin?: number;
}): RenderComparison {
  const reference = meanFingerprint(input.likedFiles.map((file) => fingerprintFile(file)));
  const candidateSimilarity = similarity(fingerprintFile(input.candidateFile), reference);
  const incumbentSimilarity = similarity(fingerprintFile(input.incumbentFile), reference);
  const margin = input.margin ?? TIE_MARGIN;
  const gap = candidateSimilarity - incumbentSimilarity;
  const winner = Math.abs(gap) <= margin ? 'tie' : gap > 0 ? 'candidate' : 'incumbent';
  return {
    winner,
    candidateSimilarity,
    incumbentSimilarity,
    margin,
    detail:
      `candidate ${candidateSimilarity.toFixed(4)} vs incumbent ${incumbentSimilarity.toFixed(4)} ` +
      `(gap ${gap >= 0 ? '+' : ''}${gap.toFixed(4)}${winner === 'tie' ? ', within the margin' : ''})`,
  };
}

