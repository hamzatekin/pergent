import { canonical, escapeHtml, host, isHttp, renderMarkdown, type Paper, type Story } from "#src/paper.ts";


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
  /** The section the story comes from, shown on a card in the picks at the top. */
  section?: string;
  /** A brief Jev scored directly useful, made a card (forReader). */
  promoted?: boolean;
};
/** The links a story's foot gets: never show (a task with a never-show list), save to notes (logged in). */
export type StoryActions = (story: Story) => { mute?: string; save?: string };
/** `picks` is the section at the top: the stories most worth the reader's time, from every section. */
export type SectionView = { heading?: string; lead?: string; cards: StoryView[]; briefs: StoryView[]; picks?: boolean };
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
export function forReader<T extends { importance: 1 | 2 | 3; forYou?: number; promoted?: boolean }>(stories: T[]): T[] {
  if (!stories.some((s) => s.forYou !== undefined)) return stories;
  const fit = (s: T) => s.forYou ?? 1.5;
  const hadLead = stories.some((s) => s.importance === 3);
  for (const s of stories) {
    if (s.importance > 1 && fit(s) < NOT_FOR_YOU) s.importance = 1;
    else if (s.importance === 1 && fit(s) >= FOR_YOU) {
      s.importance = 2;
      s.promoted = true;
    }
  }
  const sorted = [...stories].sort((a, b) => fit(b) - fit(a));
  const lead = hadLead ? sorted.find((s) => s.importance > 1) : undefined;
  for (const s of sorted) if (s.importance > 1) s.importance = s === lead ? 3 : 2;
  return sorted;
}

// The stories most worth the reader's time across the whole paper, for the top of the page in both
// layouts: the cards Jev scored highest, best first. Every card scored 2 or more ("relevant" and up)
// is in, never fewer than 3 nor more than 6, so the top is a short read whatever the day brought.
// A paper without scores has no picks, and the page keeps the model's own order.
const PICKS = { min: 3, max: 6, worth: 2 };
// The first pick leads, so it is the best one the model wrote as a story: a brief Jev promoted is a
// sentence long and would leave the lead card, or the manşet, nearly empty.
export function topPicks<T extends { importance: 1 | 2 | 3; forYou?: number; promoted?: boolean }>(sections: T[][]): T[] {
  const scored = sections.flat().filter((s) => s.importance > 1 && s.forYou !== undefined);
  const sorted = [...scored].sort((a, b) => b.forYou! - a.forYou! || b.importance - a.importance);
  const worth = sorted.filter((s) => s.forYou! >= PICKS.worth).length;
  const picks = sorted.slice(0, Math.min(PICKS.max, Math.max(PICKS.min, worth)));
  const lead = picks.find((s) => !s.promoted) ?? sorted.find((s) => !s.promoted);
  return lead ? [lead, ...picks.filter((s) => s !== lead)].slice(0, PICKS.max) : picks;
}

// "🏛️ Gündem ve Siyaset" is "Gündem ve Siyaset" as a label, and tech's "🚀 Claude …" headline is "Claude …" in print.
// biome-ignore lint/suspicious/noMisleadingCharacterClass: the variation selector (U+FE0F) and the zero-width joiner (U+200D) are part of an emoji, which is what this strips; they are not typos.
export const plain = (s: string) => s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\s]+/u, "").trim();

const PICKS_HEADING: Record<string, string> = { tr: "Okumaya değer", en: "Worth your time" };

export function paperView(paper: Paper, images: Record<string, string>, actions?: StoryActions, lang = "en"): PaperView {
  // Article links are matched to images without tracking parameters or a trailing slash.
  const byLink = new Map(Object.entries(images).map(([link, image]) => [canonical(link), image]));
  const legacy = !paper.sections.some((s) => s.stories.some((st) => st.importance));
  const sections = paper.sections.map((section) => {
    const stories = forReader(section.stories.map((story, i): StoryView => {
      const source = story.source && isHttp(story.source) ? story.source : undefined;
      const image = source ? byLink.get(canonical(source)) : undefined;
      return {
        html: `<h3>${escapeHtml(story.headline)}</h3>\n${renderMarkdown(story.body)}`,
        context: story.context ? renderMarkdown(story.context) : undefined,
        source,
        sourceHost: source && host(source),
        image: image && isHttp(image) ? image : undefined,
        importance: importance(story, i, legacy),
        forYou: story.forYou,
        ...actions?.(story),
      };
    }));
    return { heading: section.heading, lead: section.lead ? renderMarkdown(section.lead) : undefined, stories };
  });

  // The picks go to the top, the best one as its lead, each saying which section it is from; the rest
  // stay in their sections. A section whose lead was picked gives the lead to its next card, and a
  // section left with nothing is dropped.
  const leads = new Set(sections.map((s) => s.stories.find((st) => st.importance === 3)));
  const picks = topPicks(sections.map((s) => s.stories));
  picks.forEach((s, i) => {
    s.importance = i === 0 ? 3 : 2;
  });
  const views: SectionView[] = sections.flatMap((section) => {
    const rest = section.stories.filter((s) => !picks.includes(s));
    const cards = rest.filter((s) => s.importance > 1);
    if (cards[0] && section.stories.some((s) => leads.has(s) && picks.includes(s))) cards[0].importance = 3;
    for (const s of picks) if (section.stories.includes(s)) s.section = section.heading ? plain(section.heading) : undefined;
    const briefs = rest.filter((s) => s.importance === 1);
    return cards.length || briefs.length || section.lead ? [{ heading: section.heading, lead: section.lead, cards, briefs }] : [];
  });
  if (picks.length) views.unshift({ heading: PICKS_HEADING[lang.split("-")[0]] ?? PICKS_HEADING.en, cards: picks, briefs: [], picks: true });
  return { title: paper.title, sections: views };
}
