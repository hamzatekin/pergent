import { canonical, escapeHtml, host, isHttp, renderMarkdown, type Paper, type Story } from "#src/paper.ts";

import { isNoteLink } from "./notes.ts";

// What the reading page gets for a paper: every markdown field already rendered to HTML on the server,
// so marked never ships to the browser, and each story sized, given its image and sorted into the
// section's cards or briefs.
export type StoryView = {
  /** The headline (as text) and the body, one HTML string: a brief runs the headline into the first sentence. */
  html: string;
  context?: string;
  source?: string;
  sourceHost?: string;
  image?: string;
  importance: 1 | 2 | 3;
  forYou?: number;
  /** The story's "Never show" page, for a task with a never-show list (src/mute.ts). */
  mute?: string;
  /** Where the story sits in the stored paper (task/runId/section/story), for "Save to notes". */
  save?: string;
};
/** The links a story's foot gets: never show (a task with a never-show list), save to notes (logged in). */
export type StoryActions = (story: Story) => { mute?: string; save?: string };
export type SectionView = { heading?: string; lead?: string; cards: StoryView[]; briefs: StoryView[] };
export type PaperView = { title?: string; sections: SectionView[] };

// A story's size on the page. A run from before the field exists has none, so its first story per
// section leads and the rest are cards, which is the order the prompts have always implied.
function importance(story: Story, index: number, legacy: boolean): 1 | 2 | 3 {
  return story.importance === 1 || story.importance === 3 ? story.importance : legacy && index === 0 ? 3 : 2;
}

// For-you scores (src/rate.ts, 0-3): below 1 a story is mostly "not for them" and keeps a line in the
// briefs instead of a card; from 2.5 it is "directly useful to them" and gets a card even when the
// model made it a brief.
const NOT_FOR_YOU = 1;
const FOR_YOU = 2.5;

// Orders a section for the reader by Jev's for-you score, most relevant first, makes the cards that
// are not for them briefs and the briefs that are directly for them cards. When the model gave the
// section a lead, the lead is the card that matters most to the reader. A paper without scores (old runs, no key, a task without `reader`)
// keeps the model's order and sizes; a story whose request failed sits in the middle.
export function forReader<T extends { importance: 1 | 2 | 3; forYou?: number }>(stories: T[]): T[] {
  if (!stories.some((s) => s.forYou !== undefined)) return stories;
  const fit = (s: T) => s.forYou ?? 1.5;
  const hadLead = stories.some((s) => s.importance === 3);
  for (const s of stories) {
    if (s.importance > 1 && fit(s) < NOT_FOR_YOU) s.importance = 1;
    else if (s.importance === 1 && fit(s) >= FOR_YOU) s.importance = 2;
  }
  const sorted = [...stories].sort((a, b) => fit(b) - fit(a));
  const lead = hadLead ? sorted.find((s) => s.importance > 1) : undefined;
  for (const s of sorted) if (s.importance > 1) s.importance = s === lead ? 3 : 2;
  return sorted;
}

export function paperView(paper: Paper, images: Record<string, string>, actions?: StoryActions): PaperView {
  // Article links are matched to images without tracking parameters or a trailing slash.
  const byLink = new Map(Object.entries(images).map(([link, image]) => [canonical(link), image]));
  const legacy = !paper.sections.some((s) => s.stories.some((st) => st.importance));
  return {
    title: paper.title,
    sections: paper.sections.map((section) => {
      const stories = forReader(section.stories.map((story, i): StoryView => {
        const source = story.source && isHttp(story.source) ? story.source : undefined;
        const image = source ? byLink.get(canonical(source)) : undefined;
        return {
          html: `<h3>${escapeHtml(story.headline)}</h3>\n${renderMarkdown(story.body)}`,
          context: story.context ? renderMarkdown(story.context) : undefined,
          source,
          sourceHost: source && (isNoteLink(source) ? "Open note" : host(source)),
          image: image && isHttp(image) ? image : undefined,
          importance: importance(story, i, legacy),
          forYou: story.forYou,
          ...actions?.(story),
        };
      }));
      return {
        heading: section.heading,
        lead: section.lead ? renderMarkdown(section.lead) : undefined,
        cards: stories.filter((s) => s.importance > 1),
        briefs: stories.filter((s) => s.importance === 1),
      };
    }),
  };
}
