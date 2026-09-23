/**
 * The executor: turning a corpus into candidate edition N+1.
 *
 * The *decisions* about editions live in the aggregator (17.14-17.16): what the corpus may contain, whether a
 * candidate may be adopted, and what evidence authorises it. This is the part that actually spends the GPU,
 * and it is therefore the part that must be most refusal-prone, so the plan is separated from the run:
 *
 *   - `planExecution()` is **read-only**. It resolves every corpus sample to a file on disk, says which ones
 *     it could not resolve, and reports every guard that would stop a run - including the aggregator's own
 *     corpus blockers, which it does not second-guess.
 *   - `runExecution()` refuses at the first refusal and reports each step as it happens. Training needs
 *     `confirm: true`, because it occupies the engine for as long as the epochs take and the engine is
 *     single-instance: this is never something to start by accident.
 *
 * The dataset is the handoff to the engine, in the same shape the training tab builds. The difference is
 * where the samples come from - the corpus rather than an uploaded directory - and that the *held-out* half
 * never appears here, so a candidate cannot be trained on the prompts it will be judged on.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config/index.js';
import { fetchCorpus } from './aggregator.js';
import { callEngineDataset } from './engineDataset.js';
import type { StorageProvider } from './storage/index.js';

/** One sample as the corpus describes it. */
interface CorpusSample {
  id: string;
  audio: string | null;
  origin: 'song' | 'run';
  promptKey: string;
  market: string | null;
  verdict: string;
  reasons: string[];
  edition: string | null;
  createdAt: string;
  features: Record<string, unknown>;
}

export interface ResolvedSample extends CorpusSample {
  /** Where the audio was found on disk, or null when it could not be. */
  file: string | null;
  /** Why it could not be found, when it could not. */
  missing?: string;
}

export interface ExecutionPlan {
  corpusHash: string;
  corpusOrdinal: number;
  baseId: string | null;
  /** The adapter a candidate would tune *from*: the incumbent's, or null for the base model. */
  resumeCheckpoint: string | null;
  counts: Record<string, number>;
  /** Every guard that would stop a run, in the order they would be hit. */
  blockers: string[];
  /** Samples that resolved to a file on disk, and those that did not (with the reason). */
  resolved: ResolvedSample[];
  unresolved: ResolvedSample[];
  /** What would be written and called, without writing or calling anything. */
  would: {
    datasetName: string;
    datasetPath: string;
    tensorDir: string;
    outputDir: string;
    engineCalls: string[];
    heldOutPairs: number;
  };
}

/**
 * Gets one stored audio object onto local disk, because the engine reads paths rather than streams.
 *
 * The local provider keeps files under its own root, which the engine can read directly, so nothing is
 * copied; a remote provider has to be fetched into the dataset's upload directory. A failure is reported with
 * the reason rather than leaving a sample silently absent.
 */
async function materializeAudio(key: string, storage: StorageProvider): Promise<{ file: string; copied: boolean }> {
  /**
   * The provider's own root first, then configuration resolved to an absolute path.
   *
   * The first version of this used configuration alone, and the app's `.env` says `AUDIO_DIR=./public/audio`:
   * a *relative* path, valid from the server's working directory and meaningless anywhere else. The engine
   * runs from a different directory, so every sample failed to decode and preprocessing produced **zero
   * tensors** - a success-shaped failure that only the tensor count revealed.
   */
  const candidate = storage.localPath?.(key) ?? path.resolve(config.storage.audioDir, key);
  if (candidate && path.isAbsolute(candidate) && existsSync(candidate)) {
    return { file: candidate, copied: false };
  }
  const dir = path.join(config.datasets.uploadsDir, 'edition-corpus');
  const file = path.join(dir, path.basename(key));
  if (existsSync(file)) return { file, copied: true };
  const url = await storage.getUrl(key);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`could not fetch audio: HTTP ${response.status}`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return { file, copied: true };
}

/**
 * The corpus, plus every sample's audio path resolved.
 *
 * A listener's song is resolved through the app's own storage (the same key the player streams); a rated
 * render of the loop's own is a path the aggregator recorded. Either way the engine needs a local file, so
 * anything that cannot be resolved is *reported* rather than dropped - a dataset quietly missing a third of
 * its samples would train the wrong model and look fine doing it.
 */
async function resolveSamples(
  samples: CorpusSample[],
): Promise<{ resolved: ResolvedSample[]; unresolved: ResolvedSample[] }> {
  const resolved: ResolvedSample[] = [];
  const unresolved: ResolvedSample[] = [];
  const storage = await import('./storage/factory.js').then((module) => module.getStorageProvider());

  for (const sample of samples) {
    if (sample.origin === 'run') {
      const candidate = sample.audio ? path.resolve(sample.audio) : '';
      if (candidate && existsSync(candidate)) {
        resolved.push({ ...sample, file: candidate });
      } else {
        unresolved.push({
          ...sample,
          file: null,
          missing: `render not on disk (${sample.audio ?? 'no path recorded'})`,
        });
      }
      continue;
    }
    const { rows } = await pool.query('SELECT audio_url FROM songs WHERE id = $1', [sample.id]);
    const audioUrl = rows[0]?.audio_url ? String(rows[0].audio_url) : '';
    if (!audioUrl) {
      unresolved.push({ ...sample, file: null, missing: 'song has no audio' });
      continue;
    }
    const key = audioUrl.replace(/^\/audio\//, '');
    try {
      resolved.push({ ...sample, file: (await materializeAudio(key, storage)).file });
    } catch (error) {
      unresolved.push({ ...sample, file: null, missing: (error as Error).message });
    }
  }
  return { resolved, unresolved };
}

export interface ExecutionResult {
  datasetPath: string;
  tensors: number;
  tensorDir: string;
  steps: string[];
  /** Set when the run stopped: the reason, verbatim. */
  stopped?: string;
}

/**
 * Builds the dataset and preprocesses it, stopping at the first refusal and saying which one.
 *
 * `confirm` gates the training run itself: without it this does everything up to the point where the GPU
 * would be occupied and then stops, which is the useful half to run while checking the pipeline. Training is
 * *not* started from here even with `confirm` - it is handed to `/api/training/start` with the tensor
 * directory and the checkpoint this plan chose, so the step that occupies the engine stays visible.
 */
export async function runExecution(
  options: { datasetName?: string; confirm?: boolean; allowPartial?: boolean } = {},
): Promise<ExecutionResult> {
  const steps: string[] = [];
  const plan = await planExecution({ datasetName: options.datasetName });

  /**
   * Guard refusals, with one deliberate escape hatch.
   *
   * The corpus's own blockers are never overridable: they are the loop's judgement about whether a training
   * run is warranted at all. Missing audio is different in kind - the corpus is sound, but some of its
   * material cannot be reached (a render whose file was cleaned up, say). Dropping it makes the dataset *not*
   * the one the corpus's hash promises, so the default is to refuse; `allowPartial: true` proceeds and the
   * dataset records exactly which samples were dropped, so the adapter can still be traced to what it saw.
   */
  const audioBlockers = plan.blockers.filter((blocker) => blocker.includes('no audio on disk'));
  const hardBlockers = plan.blockers.filter((blocker) => !audioBlockers.includes(blocker));
  const allowedAudioBlockers = options.allowPartial === true ? [] : audioBlockers;
  const blockers = [...hardBlockers, ...allowedAudioBlockers];

  if (blockers.length > 0) {
    return {
      datasetPath: '',
      tensors: 0,
      tensorDir: plan.would.tensorDir,
      steps,
      stopped: `refused before writing anything: ${blockers.join('; ')}`,
    };
  }
  if (options.allowPartial === true && audioBlockers.length > 0) {
    steps.push(
      `proceeding without ${plan.unresolved.length} sample(s) whose audio could not be found: ` +
        `${plan.unresolved.map((sample) => sample.id).join(', ')} (recorded in the dataset)`,
    );
  }

  // The samples in the engine's shape, one entry per resolved file.
  const samples = [];
  for (const sample of plan.resolved) {
    samples.push({
      id: randomUUID().slice(0, 8),
      audio_path: sample.file,
      filename: path.basename(String(sample.file)),
      caption: typeof sample.features.style === 'string' ? sample.features.style : '',
      genre: typeof sample.features.genre === 'string' ? sample.features.genre : '',
      lyrics: await lyricsFor(sample),
      raw_lyrics: '',
      formatted_lyrics: '',
      bpm: typeof sample.features.bpm === 'number' ? sample.features.bpm : null,
      keyscale: typeof sample.features.keyScale === 'string' ? sample.features.keyScale : '',
      timesignature: '',
      duration: 0,
      language: typeof sample.features.language === 'string' ? sample.features.language : 'unknown',
      is_instrumental: false,
      /** The verdict is the training signal, so it travels with the sample rather than being lost here. */
      custom_tag: `${sample.verdict}${sample.reasons.length > 0 ? ` ${sample.reasons.join(' ')}` : ''}`,
      labeled: true,
      prompt_override: null,
    });
  }

  const dataset = {
    metadata: {
      name: plan.would.datasetName,
      custom_tag: 'edition',
      tag_position: 'prepend',
      created_at: new Date().toISOString(),
      num_samples: samples.length,
      all_instrumental: false,
      genre_ratio: 0,
      /** Provenance, so an adapter can be traced back to the corpus that produced it. */
      corpus_hash: plan.corpusHash,
      edition_ordinal: plan.corpusOrdinal,
      base_id: plan.baseId,
      /**
       * Samples the corpus named but whose audio could not be reached, when the caller accepted a partial
       * dataset. Recorded here rather than only logged: the adapter must be traceable to what it actually
       * saw, not to what the corpus intended.
       */
      dropped_samples: plan.unresolved.map((sample) => ({
        id: sample.id,
        origin: sample.origin,
        reason: sample.missing ?? 'unknown',
      })),
      corpus_train_samples: plan.counts.train ?? null,
    },
    samples,
  };

  await mkdir(config.datasets.dir, { recursive: true });
  await writeFile(plan.would.datasetPath, JSON.stringify(dataset, null, 2), 'utf-8');
  steps.push(
    `wrote dataset: ${plan.would.datasetPath} (${samples.length} sample(s) from the corpus's training half)`,
  );

  const loaded = await callEngineDataset('/v1/dataset/load', { dataset_path: plan.would.datasetPath });
  if (loaded.error) {
    return {
      datasetPath: plan.would.datasetPath,
      tensors: 0,
      tensorDir: plan.would.tensorDir,
      steps,
      stopped: loaded.error,
    };
  }
  steps.push('engine loaded the dataset');

  await mkdir(plan.would.tensorDir, { recursive: true });
  const preprocessed = await callEngineDataset(
    '/v1/dataset/preprocess',
    { output_dir: plan.would.tensorDir },
    30 * 60_000,
  );
  if (preprocessed.error) {
    return {
      datasetPath: plan.would.datasetPath,
      tensors: 0,
      tensorDir: plan.would.tensorDir,
      steps,
      stopped: preprocessed.error,
    };
  }
  const payload = (preprocessed.data ?? {}) as { message?: string; num_tensors?: number; output_dir?: string };
  const tensors = Number(payload.num_tensors ?? 0);
  steps.push(`engine preprocessed ${tensors} tensor(s) into ${payload.output_dir ?? plan.would.tensorDir}`);

  if (!options.confirm) {
    return {
      datasetPath: plan.would.datasetPath,
      tensors,
      tensorDir: plan.would.tensorDir,
      steps,
      stopped:
        'stopped before training: that step needs { confirm: true }, because it occupies the engine for the ' +
        'whole set of epochs and this engine is single-instance',
    };
  }

  steps.push(
    `training is not started from here: POST /api/training/start with tensorDir ${plan.would.tensorDir} and ` +
      `resumeCheckpoint ${plan.resumeCheckpoint ?? '(the base model)'}, then POST /api/training/export, then ` +
      'register the candidate with the aggregator',
  );
  return { datasetPath: plan.would.datasetPath, tensors, tensorDir: plan.would.tensorDir, steps };
}

/** Reads back the dataset this executor wrote, for inspection. */
export async function readDataset(datasetPath: string): Promise<unknown> {
  const raw = await readFile(datasetPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

/**
 * Lyrics for a sample, when the app knows them: the engine's sample shape expects the field.
 *
 * Whether a song is instrumental is **not** a column in this schema - `songs` has `lyrics` but no
 * `is_instrumental`, and asking for one threw `no such column` the first time this ran - so it is read from
 * the lyrics themselves, which is where the app already records it: an empty lyric, or the marker the app
 * and this executor both use, means instrumental.
 */
async function lyricsFor(sample: ResolvedSample): Promise<string> {
  if (sample.origin === 'run') return '[Instrumental]';
  const { rows } = await pool.query('SELECT lyrics FROM songs WHERE id = $1', [sample.id]);
  const lyrics = rows[0]?.lyrics ? String(rows[0].lyrics).trim() : '';
  if (!lyrics || /^\[instrumental\]$/i.test(lyrics)) return '[Instrumental]';
  return lyrics;
}

/** The adapter a candidate tunes from: the incumbent's exported LoRA, or null for the base model. */
async function incumbentAdapter(editionId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT adapter_path FROM editions WHERE id = $1', [editionId]);
  const adapter = rows[0]?.adapter_path ? String(rows[0].adapter_path) : '';
  return adapter && existsSync(adapter) ? adapter : null;
}

export async function planExecution(options: { datasetName?: string } = {}): Promise<ExecutionPlan> {
  const corpus = await fetchCorpus();
  if (!corpus.ok || !corpus.corpus) {
    throw new Error(corpus.error ?? 'the aggregator did not return a corpus');
  }
  const view = corpus.corpus;
  const datasetName = options.datasetName ?? `edition-${view.manifest.editionOrdinal}-${view.hash.slice(0, 8)}`;
  const datasetPath = path.join(config.datasets.dir, `${datasetName}.json`);
  const { resolved, unresolved } = await resolveSamples(view.train as unknown as CorpusSample[]);

  const base = view.manifest.baseId ? await incumbentAdapter(view.manifest.baseId) : null;
  const blockers: string[] = [];
  // The aggregator's own guards come first: this service does not get to overrule them.
  blockers.push(...view.manifest.blockers);
  if (unresolved.length > 0) {
    blockers.push(
      `${unresolved.length} of ${view.train.length} training sample(s) have no audio on disk, so the dataset ` +
        'would not be the one the corpus describes',
    );
  }

  return {
    corpusHash: view.hash,
    corpusOrdinal: view.manifest.editionOrdinal,
    baseId: view.manifest.baseId,
    resumeCheckpoint: base,
    counts: view.manifest.counts,
    blockers,
    resolved,
    unresolved,
    would: {
      datasetName,
      datasetPath,
      tensorDir: path.join(config.datasets.dir, `${datasetName}_tensors`),
      outputDir: path.join(config.datasets.dir, '..', 'lora_output', datasetName),
      engineCalls: [
        `POST ${config.acestep.apiUrl}/v1/dataset/load { dataset_path: ${datasetPath} }`,
        `POST ${config.acestep.apiUrl}/v1/dataset/preprocess { output_dir: <tensorDir> }`,
        'Gradio /training_wrapper (only with confirm: true)',
        'Gradio /export_lora (only with confirm: true)',
      ],
      heldOutPairs: view.heldOut.length,
    },
  };
}
