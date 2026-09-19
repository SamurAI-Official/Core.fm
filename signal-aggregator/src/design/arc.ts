/**
 * The songwriting arc this generator writes to:
 *
 *   perspective -> uncertainty -> agency -> contradiction ->
 *   concrete metaphor -> scale expansion -> unresolved or reframed conclusion
 *
 * The arc is a composing discipline, not a lyric template: each stage constrains
 * *what a section is doing*, and `lyrics.ts` supplies the grammar. Section headers
 * stay in the plain form ACE-Step expects (`[Verse 1]`, `[Chorus]`), so the engine
 * parses the scaffold exactly as before; the arc is reported separately (see
 * `LyricArcReport`) for the UI, the rationale and the run manifest.
 */
import { REFRAME_QUALIFIERS } from './lyricBanks.js';

export type LyricStage =
  | 'perspective'
  | 'uncertainty'
  | 'agency'
  | 'contradiction'
  | 'metaphor'
  | 'scale'
  | 'conclusion';

export interface ArcStageDefinition {
  id: LyricStage;
  label: string;
  /** What the stage must accomplish - surfaced in the UI and the design rationale. */
  craft: string;
}

export const LYRIC_ARC: ArcStageDefinition[] = [
  {
    id: 'perspective',
    label: 'Perspective',
    craft: 'anchor who is speaking and where/when they stand',
  },
  {
    id: 'uncertainty',
    label: 'Uncertainty',
    craft: 'admit what is not known or not settled',
  },
  {
    id: 'agency',
    label: 'Agency',
    craft: 'turn doubt into a decision or an action',
  },
  {
    id: 'contradiction',
    label: 'Contradiction',
    craft: 'hold two opposing impulses in the same breath',
  },
  {
    id: 'metaphor',
    label: 'Concrete metaphor',
    craft: 'carry the theme in a physical, specific object',
  },
  {
    id: 'scale',
    label: 'Scale expansion',
    craft: 'widen from one person to everyone sharing it',
  },
  {
    id: 'conclusion',
    label: 'Unresolved or reframed conclusion',
    craft: 'leave it open or turn the hook against itself',
  },
];

export function stageDefinition(stage: LyricStage): ArcStageDefinition {
  return LYRIC_ARC.find((entry) => entry.id === stage) ?? LYRIC_ARC[0];
}

export function stageLabel(stage: LyricStage): string {
  return stageDefinition(stage).label;
}

export interface SectionPlan {
  section: string;
  stages: LyricStage[];
  /** Marks the closing chorus, which reframes rather than repeats the hook. */
  reframe?: boolean;
}

/**
 * Maps the arc onto the song structure for a given energy level.
 * Every structure carries all seven stages; only the spacing changes.
 */
export function planFor(energy: number): SectionPlan[] {
  if (energy >= 0.75) {
    return [
      { section: 'Intro', stages: ['perspective'] },
      { section: 'Verse 1', stages: ['perspective', 'uncertainty'] },
      { section: 'Pre-Chorus', stages: ['agency'] },
      { section: 'Chorus', stages: ['contradiction'] },
      { section: 'Verse 2', stages: ['metaphor'] },
      { section: 'Chorus', stages: ['contradiction'] },
      { section: 'Bridge', stages: ['scale'] },
      { section: 'Chorus', stages: ['contradiction'], reframe: true },
      { section: 'Outro', stages: ['conclusion'] },
    ];
  }
  if (energy >= 0.45) {
    return [
      { section: 'Intro', stages: ['perspective'] },
      { section: 'Verse 1', stages: ['perspective', 'uncertainty'] },
      { section: 'Chorus', stages: ['contradiction'] },
      { section: 'Verse 2', stages: ['metaphor', 'agency'] },
      { section: 'Chorus', stages: ['contradiction'] },
      { section: 'Bridge', stages: ['scale'] },
      { section: 'Outro', stages: ['conclusion'] },
    ];
  }
  return [
    { section: 'Verse 1', stages: ['perspective', 'uncertainty'] },
    { section: 'Chorus', stages: ['contradiction'] },
    { section: 'Verse 2', stages: ['metaphor', 'agency'] },
    { section: 'Chorus', stages: ['contradiction'], reframe: true },
    { section: 'Outro', stages: ['scale', 'conclusion'] },
  ];
}

/** Results of one arc pass, for explainability in the UI and the manifest. */
export interface LyricArcReport {
  stages: LyricStage[];
  sectionMap: Array<{ section: string; stages: LyricStage[] }>;
  /** The object chosen for the concrete-metaphor stage. */
  metaphor: string;
  /** The opposing pair used by the contradiction stage. */
  contradiction: [string, string];
  conclusion: 'unresolved' | 'reframed';
  /** The wider subject used by the scale-expansion stage. */
  scaleSubject: string;
}

/**
 * Reframing the hook is owned by the language packs: the English rule ("${hook},
 * ${qualifier}") is not valid everywhere, and two competing implementations would
 * let someone edit one while the other silently kept running.
 */
export function pickReframeQualifier(rng: () => number): string {
  return REFRAME_QUALIFIERS[Math.floor(rng() * REFRAME_QUALIFIERS.length)] ?? REFRAME_QUALIFIERS[0];
}

/** One-line summary of the arc, e.g. for a rationale string. */
export function describeArc(report: LyricArcReport): string {
  const chain = report.stages.map((stage) => stageLabel(stage).toLowerCase()).join(' → ');
  const conclusion =
    report.conclusion === 'reframed'
      ? `hook reframed ("${report.contradiction[0]} / ${report.contradiction[1]}")`
      : 'conclusion left unresolved';
  return `${chain}; metaphor "${report.metaphor}"; ${conclusion}; scale via "${report.scaleSubject}"`;
}