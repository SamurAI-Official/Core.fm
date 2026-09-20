/**
 * Agent: Question -> Answer -> Bigger Question.
 *
 * Engine: question -> partial answer -> consequence -> new question.
 *
 * Every answer is partial and every answer creates the next question, so the song keeps
 * forward momentum without needing a plot. Two guaranteeable properties make this agent
 * testable rather than aspirational:
 *
 *   - the questions are drawn without repeats, so the song asks different things;
 *   - they are ordered shortest-first and the closing line is the longest of them, so the
 *     questions *lengthen* as the song goes. That is a proxy: length is not meaning, and
 *     semantic escalation needs the `ladder` primitive. The report says which it got.
 *
 * Needs `question` and `answer` from the pack. Where a pack has neither, the agent
 * degrades onto the pack's doubt lines and the plan records `agentRealised: false`.
 */
import { estimateSyllables } from '../lyrics/validate.js';
import { primitiveBank } from '../lyrics/primitives.js';
import { takeLines, type LyricContext, type LanguagePack, type ScriptFamily } from '../lyrics/types.js';
import type { AgentSection, AgentReport, WritingAgent } from './types.js';

interface Material {
  questions: string[];
  answers: string[];
  /** True when both came from the pack's own primitive banks. */
  realised: boolean;
  questionCursor: number;
  answerCursor: number;
  /**
   * Lines already used for consequences and closings anywhere in this song.
   *
   * Shared across sections on purpose: drawing each section's closing line independently let
   * the bridge and the outro land on the same line, which reads as a mistake rather than as a
   * return. Passing the same set lets the renderer reach for something else.
   */
  openUsed: Set<string>;
}

/**
 * Per-song material, cached on the context object.
 *
 * `ctx` is created once per `writeLyrics` call, so a WeakMap keyed by it gives the agent
 * song-scoped state (which question has already been asked) without the orchestrator
 * having to know that this style needs any.
 */
const materialFor = new WeakMap<LyricContext, Material>();

/**
 * Ascending line length: a longer question reads as a heavier one.
 *
 * De-duplicated as well: the fallback lists are drawn from stage banks, and a bank can
 * legitimately contain the same line twice (a reframed conclusion repeats its parenthesised
 * line on purpose). For a list whose whole job is to offer the *next* thing to ask, a repeat
 * is waste, so it is removed here rather than filtered at every use.
 */
function orderByLength(lines: string[], script: ScriptFamily): string[] {
  const unique = [...new Set(lines)];
  return unique.sort((a, b) => estimateSyllables(a, script) - estimateSyllables(b, script));
}

function material(ctx: LyricContext, pack: LanguagePack): Material {
  const cached = materialFor.get(ctx);
  if (cached) return cached;

  const banked = primitiveBank(pack, 'question');
  const answered = primitiveBank(pack, 'answer');
  const realised = banked.length > 0 && answered.length > 0;

  // Degradation path: a pack with no question bank still has doubt lines, which read as
  // unanswered questions about the singer's own position. Sorted the same way as a real
  // bank, so the rise across the song holds either way; the report says which path ran.
  const questions = orderByLength(
    realised ? banked : pack.render.uncertainty(5, ctx, new Set()),
    pack.script,
  );
  const answers = orderByLength(realised ? answered : pack.render.conclusion(4, ctx, new Set()), pack.script);

  const material: Material = {
    questions,
    answers,
    realised,
    questionCursor: 0,
    answerCursor: 0,
    openUsed: new Set<string>(),
  };
  materialFor.set(ctx, material);
  return material;
}

/** The next question in the ascending order; the heaviest one once the bank runs out. */
function nextQuestion(ctx: LyricContext, pack: LanguagePack): string {
  const state = material(ctx, pack);
  const index = Math.max(0, Math.min(state.questionCursor, state.questions.length - 1));
  state.questionCursor += 1;
  return state.questions[index] ?? ctx.hook;
}

function nextAnswer(ctx: LyricContext, pack: LanguagePack): string {
  const state = material(ctx, pack);
  const index = Math.max(0, Math.min(state.answerCursor, state.answers.length - 1));
  state.answerCursor += 1;
  return state.answers[index] ?? ctx.hook;
}

/** The heaviest question available, for the closing line. */
function biggestQuestion(ctx: LyricContext, pack: LanguagePack): string {
  const state = material(ctx, pack);
  return state.questions[state.questions.length - 1] ?? ctx.hook;
}

/** A consequence, carried by an image rather than stated. */
function consequence(ctx: LyricContext, pack: LanguagePack): string {
  return pack.render.metaphor(1, ctx, material(ctx, pack).openUsed)[0] ?? ctx.hook;
}

/** A closing line that refuses to resolve anything. */
function openLine(ctx: LyricContext, pack: LanguagePack): string {
  return pack.render.conclusion(1, ctx, material(ctx, pack).openUsed)[0] ?? ctx.hook;
}

export const questionAnswerAgent: WritingAgent = {
  id: 'question-answer',
  name: 'Question → Answer → Bigger Question',
  engine: ['question', 'partial answer', 'consequence', 'new question'],
  blurb:
    'The song opens something the listener wants resolved, answers it only partly, shows the consequence, and closes on a heavier question than it started with. Forward momentum without a plot.',
  needs: ['question', 'answer'],
  repetition: 'fault',

  // Slight preference for story-telling and high-energy genres, which is where an
  // unanswered question carries best.
  fits: ({ genre, energy }) => {
    const storytellers = new Set(['singer_songwriter', 'folk_americana', 'country', 'hip_hop_rap', 'trap']);
    return (storytellers.has(genre) ? 1.6 : 1) * (energy >= 0.6 ? 1.2 : 1);
  },

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['question', 'partial answer', 'consequence'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['question', 'partial answer', 'bigger question'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['question', 'partial answer', 'consequence'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['question', 'partial answer', 'bigger question'], lines: 3, repeatOf: 'chorus' },
    ];
    // A spoken question to open on, for high-energy songs.
    if (energy >= 0.75) {
      sections.unshift({ section: 'Intro', roles: ['question'], lines: 1, variant: 'intro' });
    }
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['bigger question', 'wider statement'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['biggest question', 'left open'], lines: 2, variant: 'outro' });

    return {
      sections,
      summary:
        'questions asked without repeats and left unanswered: each answer only opens the next question, and the song closes on the heaviest one',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'intro':
        return takeLines([nextQuestion(ctx, pack)], section.lines);

      case 'verse-1':
      case 'verse-2':
        return takeLines([nextQuestion(ctx, pack), nextAnswer(ctx, pack), consequence(ctx, pack)], section.lines);

      case 'bridge':
        return takeLines([nextQuestion(ctx, pack), openLine(ctx, pack)], section.lines);

      case 'outro':
        // The heaviest question, then a line that refuses to answer it.
        return takeLines([biggestQuestion(ctx, pack), openLine(ctx, pack)], section.lines);

      case 'chorus':
      default:
        // Two questions with one answer between them: the second is the bigger.
        return takeLines([nextQuestion(ctx, pack), nextAnswer(ctx, pack), nextQuestion(ctx, pack)], section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => {
    const state = material(ctx, pack);
    const asked = state.questions.slice(0, Math.max(1, Math.min(state.questionCursor, state.questions.length)));
    return {
      questions: asked,
      answers: state.answers.slice(0, Math.max(1, Math.min(state.answerCursor, state.answers.length))),
      // How much material existed, so a gate can tell "repeated because the bank ran out"
      // from "repeated when there was something else to ask".
      questionsAvailable: state.questions.length,
      answersAvailable: state.answers.length,
      banks: state.realised ? 'question/answer primitives' : 'fell back to doubt lines (no question bank in this pack)',
      questionLengths: asked.map((line) => estimateSyllables(line, pack.script)),
      summary: state.realised
        ? `asks ${asked.length} question(s), answers each only partly and closes on its heaviest; question length rises across the song as a stand-in for rising stakes`
        : `asks ${asked.length} doubt line(s) and leaves them open (this pack has no question/answer bank yet) - structural change only`,
      // The arrangement is reported too, so the UI can show the shape without the agent.
      sections: plan.sections.map((entry) => `${entry.section}: ${entry.roles.join(' + ')}`),
    };
  },
};

