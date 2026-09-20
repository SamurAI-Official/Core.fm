/**
 * The lyric provenance recorded on a concept.
 *
 * Shared between the designer and the reroll endpoint on purpose: both write the same
 * fields from a `LyricPlan`, and two copies of this list would drift the moment a field
 * was added - which is exactly how `params.lyricSubject` would have gone missing from one
 * of the two paths.
 */
import type { LyricPlan } from './lyrics.js';
import type { LyricValidation } from './lyrics/validate.js';

export function lyricProvenance(plan: LyricPlan, validation: LyricValidation): Record<string, unknown> {
  return {
    hook: plan.hook,
    structure: plan.structure,
    // The arc's own report, kept for the arc style (existing concepts, the Trends panel and
    // the CLI all read it); other styles describe themselves below.
    ...(plan.arc ? { lyricArc: plan.arc, lyricArcSummary: plan.arcSummary } : {}),
    // Language provenance: what the market asked for vs. what was written, so a fallback is
    // visible in the UI and the run manifest rather than discovered by listening.
    requestedLanguage: plan.requestedLanguage,
    lyricLanguage: plan.language,
    lyricLanguageFallback: plan.languageFallback,
    lyricLanguageNote: plan.languageNote,
    lyricPack: plan.packLabel,
    // What the song is about, and where that came from: the market's own chart words and
    // themes, rotation, or a seeded draw.
    lyricSubject: plan.subject,
    lyricSubjectLabel: plan.subjectLabel,
    lyricSubjectSource: plan.subjectSource,
    lyricSubjectMatched: plan.subjectMatched,
    lyricSubjectRealised: plan.subjectRealised,
    // The writing style that built this song, and what it did: the engine chain, the
    // arrangement (section -> roles) and the style's own report (the refrain and its
    // readings, the questions asked...). All generic - the UI reads these for every style
    // without knowing any style in particular.
    lyricAgent: plan.agent,
    lyricAgentName: plan.agentName,
    lyricAgentEngine: plan.agentEngine,
    lyricAgentBlurb: plan.agentBlurb,
    lyricAgentSource: plan.agentSource,
    lyricAgentRealised: plan.agentRealised,
    lyricAgentSummary: plan.agentSummary,
    lyricAgentReport: plan.agentReport,
    lyricStructure: plan.agentStructure,
    lyricRepetitionPolicy: plan.repetitionPolicy,
    // Singability gate: score plus the specific lines that failed it.
    lyricValidation: {
      score: validation.score,
      lineCount: validation.lineCount,
      targetSyllables: validation.targetSyllables,
      syllableRange: validation.syllableRange,
      meterFit: validation.meterFit,
      rhymeDensity: validation.rhymeDensity,
      repetition: validation.repetition,
      repeatedLines: validation.repeatedLines,
      scriptConsistency: validation.scriptConsistency,
      detectedScript: validation.detectedScript,
      cliches: validation.cliches,
      issues: validation.issues,
    },
  };
}
