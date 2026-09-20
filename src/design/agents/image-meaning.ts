/**
 * Agent: The Image -> Image -> Image -> Meaning (arrangement-only).
 *
 * Engine: concrete image -> concrete image -> pattern recognition -> emotional realisation.
 *
 * Nothing is explained until three physical things have been put in a row, and then one line
 * says what they were for. The images are drawn without repeats so the pattern is real, and
 * the meaning line prefers the pack's `universal` bank when it has one, falling back to its
 * closing lines when it does not.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { optionalPrimitive, songState, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/**
 * Three images and the meaning they add up to, drawn once per song.
 *
 * Images come from the object bank first and then from concrete place detail: Korean and Chinese
 * packs render their object stage as an object plus one answer-line, so the object bank alone
 * cannot always supply three *different* images - and "three images" is the engine.
 */
function imagesOf(ctx: LyricContext, pack: LanguagePack): { images: string[]; meaning: string } {
  return songState(ctx, 'image-meaning:material', () => {
    const used = new Set<string>();
    const images: string[] = [];
    const draw = (stage: 'metaphor' | 'perspective' | 'uncertainty'): void => {
      for (const line of stageLines(pack, ctx, stage, 4, used)) {
        if (images.length >= 3) return;
        if (used.has(line)) continue;
        used.add(line);
        images.push(line);
      }
    };
    draw('metaphor');
    draw('perspective');
    draw('uncertainty');

    const meaning =
      optionalPrimitive(pack, 'universal')[0] ?? stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook;
    return { images, meaning };
  });
}

export const imageMeaningAgent: WritingAgent = {
  id: 'image-meaning',
  name: 'The Image → Image → Image → Meaning',
  engine: ['concrete image', 'concrete image', 'pattern recognition', 'emotional realisation'],
  blurb:
    'Three physical things in a row, then one line that says what they were for. The listener builds the emotional reality first, so the meaning lands as a realisation rather than as a statement.',
  needs: [],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['image'], lines: 2, variant: 'image-1' },
      { section: 'Verse 2', roles: ['image', 'image'], lines: 3, variant: 'image-2' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['image'], lines: 2, variant: 'image-3' });
    }
    sections.push({ section: 'Chorus', roles: ['pattern'], lines: 2, variant: 'chorus' });
    sections.push({ section: 'Outro', roles: ['meaning'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'three concrete images in a row, then the meaning they were standing in for',
    };
  },

  write: (section, ctx, pack) => {
    const { images, meaning } = imagesOf(ctx, pack);
    switch (section.variant) {
      case 'image-1':
        return takeLines([images[0] ?? ctx.metaphor], section.lines);

      case 'image-2':
        return takeLines(uniq([images[1] ?? ctx.metaphor, images[2] ?? ctx.metaphor]), section.lines);

      case 'image-3':
        return takeLines(
          uniq([stageLines(pack, ctx, 'perspective', 1)[0] ?? ctx.hook, images[0] ?? ctx.metaphor]),
          section.lines,
        );

      case 'outro':
        // The realisation, then the hook under it - unless the meaning *is* the hook, in which
        // case saying it twice in one section would be a fault rather than an echo.
        return takeLines(uniq([meaning, ctx.hook]), section.lines);

      case 'chorus':
      default:
        return takeLines(uniq([ctx.hook, stageLines(pack, ctx, 'contradiction', 2)[0] ?? ctx.hook]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => {
    const { images, meaning } = imagesOf(ctx, pack);
    return {
      images,
      meaning,
      distinctImages: new Set(images).size,
      summary: `${new Set(images).size} image(s) then the meaning: "${meaning}"`,
      sections: plan.sections.map((entry) => entry.section),
    };
  },
};
