import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Absolute path to the ACE-Step engine directory.
 *
 * Honours `ACESTEP_PATH` - the documented way to point Core.fm at an engine that is
 * not inside this repo - and otherwise defaults to a sibling directory.
 *
 * This lives in one place because it used to be duplicated: `services/acestep.ts`
 * resolved it correctly (reading the env var) while `config.datasets` used a
 * hardcoded relative path that ignored it. In a layout where the engine sits *beside*
 * `ace-step-ui` rather than inside it, that made the training dataset directory
 * resolve to a path that does not exist, so dataset uploads, preprocessed tensors and
 * the trainer each disagreed about where the data lived.
 */
export function resolveAceStepDir(): string {
  const envPath = process.env.ACESTEP_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  // Default: sibling of this repo. Both this module and services/acestep.ts sit three
  // levels below the repo root, so the same relative depth applies.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../ACE-Step-1.5');
}
