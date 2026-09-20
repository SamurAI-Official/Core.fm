/**
 * Pack primitives: whole lines an agent may place freely.
 *
 * This is deliberately a different kind of bank from `render` in the language pack.
 * `render` supplies lines for *templates the pack owns*, so a bank entry only has to be
 * correct inside the one grammatical slot it was written for. A primitive is chosen and
 * ordered by the **agent**, with no template around it, so a primitive entry must be a
 * complete, standalone line that reads correctly wherever it lands.
 *
 * That rule is what keeps twenty writing styles from becoming twenty new ways to break
 * Korean or French grammar: the agent composes, the pack guarantees.
 *
 * Coverage is derived from the table itself (a primitive exists when it has entries), so
 * there is no second declaration to drift out of sync. An agent whose `needs` are not met
 * by a pack is simply never chosen for that pack - and if one is forced anyway, the plan
 * records `agentRealised: false` and the agent degrades onto the pack's general material.
 */
import type { LanguagePack } from './types.js';

export type PrimitiveId =
  | 'question'
  | 'answer'
  | 'claim'
  | 'reversal'
  | 'implication'
  | 'universal'
  | 'ladder'
  | 'fragment';

export const PRIMITIVE_IDS: PrimitiveId[] = [
  'question',
  'answer',
  'claim',
  'reversal',
  'implication',
  'universal',
  'ladder',
  'fragment',
];

/** What each primitive is for, in the words the UI and the docs use. */
export const PRIMITIVE_LABELS: Record<PrimitiveId, string> = {
  question: 'a question the listener wants answered',
  answer: 'a partial answer to it',
  claim: 'a stated position: a promise, a confession, a belief',
  reversal: 'a line that undercuts the claim it follows',
  implication: 'what the image implies, before the wider truth',
  universal: 'the wider human statement the detail was standing in for',
  ladder: 'one ordered escalation step (array order is the escalation order)',
  fragment: 'a short, stripped line for after a break',
};

/** The pack's bank for a primitive, or an empty list when it has none. */
export function primitiveBank(pack: LanguagePack, id: PrimitiveId): string[] {
  return pack.primitives?.[id] ?? [];
}

/** True when the pack supplies every primitive an agent needs. */
export function coversPrimitives(pack: LanguagePack, needs: PrimitiveId[]): boolean {
  return needs.every((id) => primitiveBank(pack, id).length > 0);
}

/** Primitive ids a pack declares, for reporting and docs. */
export function primitiveIdsOf(
  table: Partial<Record<PrimitiveId, string[]>> | undefined,
): PrimitiveId[] {
  return PRIMITIVE_IDS.filter((id) => (table?.[id] ?? []).length > 0);
}
