/**
 * The writing-agent registry.
 *
 * Registration order is documentation order: the arc first (it is the default and the
 * behaviour every existing concept was written with), then the styles added on top of it.
 *
 * Selection mirrors the subject engine deliberately: coverage-filtered, rotation-aware
 * (subjects a market has already had are passed in as exclusions), weighted by the agent's
 * own genre/energy affinity, and always reported - the source is recorded on the concept
 * so a style chosen by affinity is distinguishable from one chosen by rotation.
 */
import { availableLanguages, resolvePack } from '../lyrics/index.js';
import { coversPrimitives, PRIMITIVE_LABELS, type PrimitiveId } from '../lyrics/primitives.js';
import type { LanguagePack } from '../lyrics/types.js';
import { arcAgent } from './arc.js';
import { callResponseAgent } from './call-response.js';
import { characterChoiceAgent } from './character-choice.js';
import { circularAgent } from './circular.js';
import { confessionDenialAgent } from './confession-denial.js';
import { countdownAgent } from './countdown.js';
import { escalatingStakesAgent } from './escalating-stakes.js';
import { everybodySaysAgent } from './everybody-says.js';
import { falseResolutionAgent } from './false-resolution.js';
import { grooveReturnAgent } from './groove-return.js';
import { hookVariationPayoffAgent } from './hook-variation-payoff.js';
import { imageMeaningAgent } from './image-meaning.js';
import { missingCharacterAgent } from './missing-character.js';
import { objectSymbolAgent } from './object-symbol.js';
import { oneLinePremiseAgent } from './one-line-premise.js';
import { promiseViolationAgent } from './promise-violation.js';
import { questionAnswerAgent } from './question-answer.js';
import { refrainMutationAgent } from './refrain-mutation.js';
import { sloganStoryAgent } from './slogan-story.js';
import { specificUniversalAgent } from './specific-universal.js';
import { thoughtActuallyAgent } from './thought-actually.js';
import type { AgentSource, WritingAgent } from './types.js';

/**
 * Every writing style, in the order the design brief lists them (the arc first, because it is the
 * default and the one every pre-existing concept was written with).
 */
export const AGENTS: WritingAgent[] = [
  arcAgent,
  hookVariationPayoffAgent,
  questionAnswerAgent,
  specificUniversalAgent,
  promiseViolationAgent,
  confessionDenialAgent,
  imageMeaningAgent,
  characterChoiceAgent,
  escalatingStakesAgent,
  falseResolutionAgent,
  callResponseAgent,
  sloganStoryAgent,
  countdownAgent,
  thoughtActuallyAgent,
  objectSymbolAgent,
  everybodySaysAgent,
  grooveReturnAgent,
  oneLinePremiseAgent,
  circularAgent,
  missingCharacterAgent,
  refrainMutationAgent,
];

/** The arc stays the default: no existing concept changes structure. */
export const DEFAULT_AGENT = arcAgent.id;

export function getAgent(id: string | undefined): WritingAgent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

/** Agents whose `needs` the pack satisfies. Empty when nothing fits, hence the caller's guard. */
export function availableAgents(pack: LanguagePack): WritingAgent[] {
  return AGENTS.filter((agent) => coversPrimitives(pack, agent.needs));
}

/** Descriptor for the API and the UI, including which packs can realise the style. */
export interface AgentDescriptor {
  id: string;
  name: string;
  engine: string[];
  blurb: string;
  needs: Array<{ id: PrimitiveId; label: string }>;
  repetition: 'fault' | 'device';
  /** Pack codes that can write this style today. */
  packs: string[];
}

export function listAgents(): AgentDescriptor[] {
  const languages = availableLanguages();
  return AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    engine: agent.engine,
    blurb: agent.blurb,
    needs: agent.needs.map((id) => ({ id, label: PRIMITIVE_LABELS[id] })),
    repetition: agent.repetition,
    packs: languages
      .filter((language) => coversPrimitives(resolvePack(language.code).pack, agent.needs))
      .map((language) => language.code),
  }));
}

export interface AgentChoice {
  agent: WritingAgent;
  source: AgentSource;
}

/**
 * Chooses the writing style for one song.
 *
 * `forced` wins outright - a user asking for a specific style gets that style, even when
 * the pack cannot fully realise it, and the plan then records `agentRealised: false`
 * rather than quietly substituting a different arrangement. Otherwise the pool is limited
 * to what the pack can write, `exclude` biases away from styles the market has just had,
 * and `fits()` weights the draw.
 */
export function chooseAgent(options: {
  rng: () => number;
  genre: string;
  energy: number;
  pack: LanguagePack;
  exclude?: string[];
  forced?: string;
}): AgentChoice {
  const forced = getAgent(options.forced);
  if (forced) return { agent: forced, source: 'seeded' };

  const covered = availableAgents(options.pack);
  const candidates = covered.length > 0 ? covered : [arcAgent];

  const excluded = new Set(options.exclude ?? []);
  const fresh = candidates.filter((agent) => !excluded.has(agent.id));
  const usable = fresh.length > 0 ? fresh : candidates;

  const weighted = usable.map((agent) => ({
    agent,
    weight: Math.max(0.05, agent.fits?.({ genre: options.genre, energy: options.energy }) ?? 1),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = options.rng() * total;
  let pick = weighted[weighted.length - 1];
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) {
      pick = entry;
      break;
    }
  }

  const affinityUsed = weighted.some((entry) => entry.weight !== 1);
  return {
    agent: pick.agent,
    source: fresh.length > 0 && excluded.size > 0 ? 'rotation' : affinityUsed ? 'affinity' : 'seeded',
  };
}
