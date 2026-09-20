/**
 * The original seven-stage arc, as a writing agent.
 *
 * This is the default agent and the reference implementation: it wraps `arc.ts` and
 * `lyricStages.ts` unchanged, so every concept that already exists keeps the structure it
 * was written with, and `params.lyricArc` (the arc report the Trends panel renders) is
 * still produced exactly as before.
 *
 * Nothing here is language-aware, which is the point of the agent/pack split: the arc
 * asks for roles, the pack supplies the grammar for them.
 */
import { describeArc, LYRIC_ARC, planFor, type LyricArcReport, type LyricStage } from '../arc.js';
import { renderSection, sectionLineCount } from '../lyricStages.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/** Rebuilds the arc's own SectionPlan from an agent section (roles are arc stage ids). */
function asArcSection(section: AgentSection) {
  return {
    section: section.section,
    stages: section.roles as LyricStage[],
    reframe: section.variant === 'reframe',
  };
}

export const arcAgent: WritingAgent = {
  id: 'arc',
  name: 'Narrative arc',
  engine: [
    'perspective',
    'uncertainty',
    'agency',
    'contradiction',
    'concrete metaphor',
    'scale expansion',
    'unresolved or reframed conclusion',
  ],
  blurb:
    'The original seven stages: who is speaking and where they stand, what is not settled, the turn to agency, two opposing impulses held in one breath, a physical object that carries the theme, a widening from one person to everyone sharing it, and an ending left open or turned against the hook.',
  needs: [],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = planFor(energy).map((entry) => ({
      section: entry.section,
      roles: entry.stages as string[],
      lines: sectionLineCount(entry.section),
      // The closing chorus reframes, so it must not share the plain chorus's lines.
      variant: entry.reframe ? 'reframe' : undefined,
    }));
    return {
      sections,
      // Replaced by `report()` once the arc's own choices are known.
      summary: 'seven-stage arc',
    };
  },

  write: (section, ctx, pack) => renderSection(asArcSection(section), ctx, pack),

  report: (ctx, plan, pack): AgentReport => {
    const usedStages = new Set<LyricStage>(plan.sections.flatMap((entry) => entry.roles as LyricStage[]));
    const report: LyricArcReport = {
      // Filtered through the arc's own order, so the chips read perspective -> ... ->
      // conclusion rather than in whatever order the sections happened to name them.
      stages: LYRIC_ARC.map((entry) => entry.id).filter((stage) => usedStages.has(stage)),
      sectionMap: plan.sections.map((entry) => ({
        section: entry.variant === 'reframe' ? `${entry.section} (reframed)` : entry.section,
        stages: entry.roles as LyricStage[],
      })),
      metaphor: ctx.metaphor,
      contradiction: ctx.contradiction,
      conclusion: ctx.conclusion,
      scaleSubject: ctx.wideSubject,
    };
    // `pack` is unused: the arc's report is about structure and the shared context only.
    void pack;
    // Written out field by field rather than spread: the report is also stored as an
    // AgentReport, and an explicit literal is what satisfies its index signature.
    return {
      stages: report.stages,
      sectionMap: report.sectionMap,
      metaphor: report.metaphor,
      contradiction: report.contradiction,
      conclusion: report.conclusion,
      scaleSubject: report.scaleSubject,
      summary: describeArc(report),
    };
  },
};

/** Exported for the docs and the UI: the arc's role order, as declared. */
export const ARC_ENGINE = arcAgent.engine;