import { canonical, escapeHtml, host, isHttp, renderMarkdown, type Paper, type Rating, type Story } from "#src/paper.ts";

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
  rating?: Rating;
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

export function paperView(paper: Paper, images: Record<string, string>, actions?: StoryActions): PaperView {
  // Article links are matched to images without tracking parameters or a trailing slash.
  const byLink = new Map(Object.entries(images).map(([link, image]) => [canonical(link), image]));
  const legacy = !paper.sections.some((s) => s.stories.some((st) => st.importance));
  return {
    title: paper.title,
    sections: paper.sections.map((section) => {
      const stories = section.stories.map((story, i): StoryView => {
        const source = story.source && isHttp(story.source) ? story.source : undefined;
        const image = source ? byLink.get(canonical(source)) : undefined;
        return {
          html: `<h3>${escapeHtml(story.headline)}</h3>\n${renderMarkdown(story.body)}`,
          context: story.context ? renderMarkdown(story.context) : undefined,
          source,
          sourceHost: source && (isNoteLink(source) ? "Open note" : host(source)),
          image: image && isHttp(image) ? image : undefined,
          importance: importance(story, i, legacy),
          rating: story.rating,
          ...actions?.(story),
        };
      });
      return {
        heading: section.heading,
        lead: section.lead ? renderMarkdown(section.lead) : undefined,
        cards: stories.filter((s) => s.importance > 1),
        briefs: stories.filter((s) => s.importance === 1),
      };
    }),
  };
}
