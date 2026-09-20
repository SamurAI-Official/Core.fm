/**
 * Writing agents: the structural half of lyric generation.
 *
 * Until now there was one structure - the seven-stage arc - so every market, genre and
 * subject was told the same way. A writing agent is a named way of *building* a song
 * (Hook -> Variation -> Payoff, Question -> Answer -> Bigger Question, escalating stakes,
 * a countdown, a circular return...). Agents compose; language packs still own grammar.
 *
 * The separation is the whole point:
 *
 *   - an agent decides the arrangement (which sections exist, what each is doing, which
 *     lines repeat, what comes back), and needs no language knowledge at all;
 *   - a pack supplies the words for the roles the agent asks for, through the same
 *     banks and primitives it already uses.
 *
 * `needs` is a capability request, not a wish: an agent is only chosen for a pack that
 * supplies every primitive it asks for (`coversPrimitives`), so a style can never be
 * labelled onto lyrics the pack could not really write.
 */
import type { LyricContext, LanguagePack } from '../lyrics/types.js';
import type { PrimitiveId } from '../lyrics/primitives.js';

/**
 * One section of an arrangement.
 *
 * Agents own the line budget because their engines do (an escalation ladder needs five
 * lines in one verse; a refrain needs one), which is exactly what the arc could not do
 * with a per-section-name default.
 */
export interface AgentSection {
  /** Engine header ACE-Step parses, without brackets: `Verse 1`, `Chorus`, `Outro`. */
  section: string;
  /** What this section is doing, in the agent's own vocabulary (UI + manifest). */
  roles: string[];
  /** Lines to render. Agents may return fewer; the writer never pads. */
  lines: number;
  /**
   * Distinguishes sections that share a header but must render differently - a refrain
   * mutation, a closing bookend. Sections with the same variant render byte-identically,
   * which is what makes a repeated hook a hook rather than a coincidence.
   */
  variant?: string;
  /** Render this section as an exact copy of an earlier variant (a circular return). */
  repeatOf?: string;
}

export interface AgentPlan {
  sections: AgentSection[];
  /** One-line English description of the arrangement, for the rationale and the UI. */
  summary: string;
}

/** How the agent was chosen, recorded on the concept alongside the subject's source. */
export type AgentSource = 'rotation' | 'affinity' | 'seeded';

export interface WritingAgent {
  id: string;
  /** Display name, e.g. 'Hook → Variation → Payoff'. */
  name: string;
  /** The engine chain, in the words of the design brief: claim -> repetition -> ... */
  engine: string[];
  /** One-line description of what the style does, for the UI and docs. */
  blurb: string;
  /** Primitives this agent needs from the pack (whole standalone lines). */
  needs: PrimitiveId[];
  /**
   * Whether the agent repeats lines on purpose. `device` exempts its repeats from the
   * validator's fault metric (a gate then asserts the device was actually used).
   */
  repetition: 'fault' | 'device';
  /** Production intent the style implies, appended to the style prompt. */
  styleHints?: string[];

  /** Affinity weight for a genre/energy pair; 1 means no opinion. */
  fits?(input: { genre: string; energy: number }): number;

  plan(input: { energy: number; rng: () => number }): AgentPlan;

  /**
   * Renders one section. `used` carries lines already emitted in this section so an
   * agent cannot repeat itself by accident; `ctx` and `pack` are the same ones the arc
   * writer uses.
   */
  write(section: AgentSection, ctx: LyricContext, pack: LanguagePack, used: Set<string>): string[];

  /** Extra provenance for the concept (a refrain and its readings, the questions asked). */
  report?(ctx: LyricContext, plan: AgentPlan, pack: LanguagePack): AgentReport;
}

/**
 * What an agent reports about the song it just built.
 *
 * `summary` is the line that goes into the rationale; everything else is stored on the
 * concept's params verbatim, so a style can explain itself (the refrain and how many
 * times it was re-read, the questions the song asks) without the orchestrator knowing
 * anything about that style in particular.
 */
export interface AgentReport {
  summary?: string;
  [key: string]: unknown;
}
