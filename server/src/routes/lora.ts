import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getGradioClient } from '../services/gradio-client.js';
import { resolvePythonPath } from '../services/acestep.js';
import { resolveAceStepDir } from '../config/acestepPath.js';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM: `__dirname` does not exist at runtime (same fix as training.ts).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Local LoRA state tracking (Gradio doesn't have a dedicated status endpoint)
let loraState = {
  loaded: false,
  active: false,
  scale: 1.0,
  path: '',
};

/**
 * True when the engine reported a refusal.
 *
 * Each LoRA endpoint answers with a human-readable status that begins with a cross on failure
 * ("LoRA loading is not supported on quantized models", "Invalid adapter: expected PEFT LoRA
 * directory..."). None of these routes used to inspect it, so `/load` answered `loaded: true` for an
 * adapter the engine had just refused, and the UI showed it as installed.
 */
function engineRefused(status: unknown): boolean {
  return typeof status === 'string' && status.trim().startsWith('\u274c');
}

/**
 * Remember the outcome of a load inside the adapter's manifest.
 *
 * `verification.ok` only says the weights matched the checkpoint on disk when they were imported.
 * "Confirmed working" has to mean the engine actually loaded it, which is what this records and
 * what GET /list reads back - so the Create tab only offers adapters known to load.
 */
function recordLoadOutcome(adapterPath: string, ok: boolean, detail: string): void {
  try {
    const dir = adapterPath.toLowerCase().endsWith('.safetensors') ? path.dirname(adapterPath) : adapterPath;
    const manifestPath = path.join(dir, 'lora_manifest.json');
    if (!existsSync(manifestPath)) return; // hand-made folder: nothing to annotate
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    manifest.lastLoad = { at: new Date().toISOString(), ok, detail: detail.slice(0, 400) };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (error) {
    console.error('[LoRA] Could not record load outcome:', error);
  }
}

// POST /api/lora/load — Load a LoRA adapter
router.post('/load', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { lora_path } = req.body;
    if (!lora_path || typeof lora_path !== 'string') {
      res.status(400).json({ error: 'lora_path is required' });
      return;
    }

    const client = await getGradioClient();
    const result = await client.predict('/load_lora', [lora_path]);
    const status = (result.data as unknown[])[0] as string;

    if (engineRefused(status)) {
      loraState = { loaded: false, active: false, scale: loraState.scale, path: '' };
      recordLoadOutcome(lora_path, false, String(status));
      res.status(409).json({ error: String(status).trim(), lora_path, loaded: false });
      return;
    }

    loraState = { loaded: true, active: true, scale: loraState.scale, path: lora_path };
    recordLoadOutcome(lora_path, true, String(status));

    res.json({ message: status, lora_path, loaded: true });
  } catch (error) {
    console.error('[LoRA] Load error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load LoRA' });
  }
});

// POST /api/lora/unload — Unload the current LoRA adapter
router.post('/unload', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const client = await getGradioClient();
    const result = await client.predict('/unload_lora', []);
    const status = (result.data as unknown[])[0] as string;

    if (engineRefused(status)) {
      res.status(409).json({ error: String(status).trim(), loaded: loraState.loaded });
      return;
    }

    loraState = { loaded: false, active: false, scale: 1.0, path: '' };

    res.json({ message: status });
  } catch (error) {
    console.error('[LoRA] Unload error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to unload LoRA' });
  }
});

// POST /api/lora/scale — Set LoRA scale (0.0 - 1.0)
router.post('/scale', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { scale } = req.body;
    if (typeof scale !== 'number' || scale < 0 || scale > 1) {
      res.status(400).json({ error: 'scale must be a number between 0 and 1' });
      return;
    }

    const client = await getGradioClient();
    const result = await client.predict('/set_lora_scale', [scale]);
    const status = (result.data as unknown[])[0] as string;

    if (engineRefused(status)) {
      res.status(409).json({ error: String(status).trim(), scale: loraState.scale, applied: false });
      return;
    }

    loraState.scale = scale;

    res.json({ message: status, scale });
  } catch (error) {
    console.error('[LoRA] Scale error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to set LoRA scale' });
  }
});

// POST /api/lora/toggle — Toggle LoRA on/off
router.post('/toggle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled } = req.body;
    const useLoRA = typeof enabled === 'boolean' ? enabled : !loraState.active;

    const client = await getGradioClient();
    const result = await client.predict('/set_use_lora', [useLoRA]);
    const status = (result.data as unknown[])[0] as string;

    if (engineRefused(status)) {
      res.status(409).json({ error: String(status).trim(), active: loraState.active, applied: false });
      return;
    }

    loraState.active = useLoRA;

    res.json({ message: status, active: useLoRA });
  } catch (error) {
    console.error('[LoRA] Toggle error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to toggle LoRA' });
  }
});

// GET /api/lora/status — Get current LoRA state
router.get('/status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  res.json(loraState);
});

// GET /api/lora/list — Adapters imported into <engine>/loras, with their manifests
router.get('/list', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const root = path.join(resolveAceStepDir(), 'loras');
    if (!existsSync(root)) {
      res.json({ adapters: [], lorasDir: root });
      return;
    }

    const adapters = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const dir = path.join(root, entry.name);
        // The import script writes this; its absence means the folder was made by hand.
        const manifestPath = path.join(dir, 'lora_manifest.json');
        let manifest: Record<string, unknown> | null = null;
        try {
          manifest = existsSync(manifestPath)
            ? (JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>)
            : null;
        } catch {
          manifest = null;
        }
        const lastLoad = manifest?.lastLoad as { ok?: boolean; at?: string; detail?: string } | undefined;
        const verified = (manifest?.verification as { ok?: boolean } | undefined)?.ok ?? null;
        return {
          name: entry.name,
          path: dir,
          configSource: (manifest?.config as { source?: string } | undefined)?.source ?? 'unknown',
          rank: (manifest?.config as { r?: number } | undefined)?.r ?? null,
          alpha: (manifest?.config as { lora_alpha?: number } | undefined)?.lora_alpha ?? null,
          repo: (manifest?.repo as string | undefined) ?? null,
          verified,
          // "Confirmed working" = the weights matched the running checkpoint at import time AND the
          // engine has actually loaded this adapter since. Anything less is presented as unconfirmed
          // rather than offered as a safe choice.
          confirmed: Boolean(verified && lastLoad?.ok),
          lastLoadAt: lastLoad?.at ?? null,
          lastLoadError: lastLoad?.ok === false ? lastLoad.detail ?? null : null,
        };
      });

    res.json({ adapters, lorasDir: root, active: loraState });
  } catch (error) {
    console.error('[LoRA] List error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list adapters' });
  }
});

// POST /api/lora/import — Pull a Hugging Face LoRA repo in and normalise it for the engine
//
// Community repos routinely ship weights without an adapter_config.json, and some were saved
// through several nested PEFT wrappers (keys beginning `base_model.model.` more than once, which
// PEFT will not match). scripts/hf_lora_import.py profiles the weights, verifies them against the
// served checkpoint, rewrites the keys and synthesises the config; this route just drives it.
router.post('/import', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { repoId, name, alpha } = req.body;
    if (!repoId || typeof repoId !== 'string') {
      res.status(400).json({ error: 'repoId is required (e.g. "owner/repo-name")' });
      return;
    }

    const engineDir = resolveAceStepDir();
    const localName =
      typeof name === 'string' && name.trim()
        ? name.trim()
        : repoId.split('/').pop()!.replace(/[^A-Za-z0-9._-]/g, '-');
    const scriptPath = path.join(__dirname, '../../scripts/hf_lora_import.py');
    if (!existsSync(scriptPath)) {
      res.status(500).json({ error: `Import script not found: ${scriptPath}` });
      return;
    }

    const args = [scriptPath, '--repo', repoId, '--name', localName, '--json', '--engine-dir', engineDir];
    if (typeof alpha === 'number') args.push('--alpha', String(alpha));

    const pythonPath = resolvePythonPath(engineDir);
    const child = spawn(pythonPath, args, { cwd: engineDir, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Downloads of a few hundred MB plus verification take a while; this is a long request, but
    // unlike a stray failure it always resolves with the script's own summary.
    child.on('close', (code: number | null) => {
      const summaryLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
      let summary: Record<string, unknown> = {};
      try {
        summary = JSON.parse(summaryLine) as Record<string, unknown>;
      } catch {
        summary = { rawOutput: stdout.trim().slice(-4000) };
      }

      if (code !== 0) {
        res.status(422).json({
          error: 'Import failed',
          code,
          summary,
          stderr: stderr.trim().slice(-4000),
        });
        return;
      }

      res.json({ imported: true, name: localName, ...summary });
    });

    child.on('error', (error: Error) => {
      res.status(500).json({ error: `Failed to run the import script: ${error.message}` });
    });
  } catch (error) {
    console.error('[LoRA] Import error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to import adapter' });
  }
});

export default router;
