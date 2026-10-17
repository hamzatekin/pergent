import { canonical, host, isHttp, renderMarkdown, type Paper, type Rating, type Story } from "#src/paper.ts";

// The paper laid out as a printed Turkish daily (Posta, Milliyet, Hürriyet): page one with the
// sürmanşet band above the masthead, the manşet under it and a few more stories, then a page per
// section. The model picks each story's place and writes its kicker, display headline and spot
// (src/paper.ts); a paper from before those fields gets its front page from importance and order.
export type NewsStory = {
  /** The story's anchor, for the "continued on page" links. */
  id: string;
  kicker?: string;
  /** The display headline when the model wrote one, else the plain headline. */
  headline: string;
  spot?: string;
  /** The body, as HTML. */
  body: string;
  context?: string;
  source?: string;
  sourceHost?: string;
  image?: string;
  importance: 1 | 2 | 3;
  rating?: Rating;
  mute?: string;
  /** The inner page the story is printed on, when it is on one. */
  page?: number;
};
export type NewsPage = { number: number; heading: string; lead?: NewsStory; stories: NewsStory[]; briefs: NewsStory[] };
export type NewspaperView = {
  name: string;
  motto?: string;
  date: string;
  issue: number;
  price?: string;
  lead?: NewsStory;
  top: NewsStory[];
  front: NewsStory[];
  /** The leads of the inner pages that are not on page one, as boxes at its foot pointing inside. */
  teasers: NewsStory[];
  pages: NewsPage[];
};
export type NewspaperConfig = { name?: string; motto?: string };

// "🏛️ Gündem ve Siyaset" is "Gündem ve Siyaset" on its page's header strip.
const plainHeading = (s: string) => s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍\s]+/u, "").trim();

export function newspaperView(
  paper: Paper,
  images: Record<string, string>,
  meta: { config: NewspaperConfig; startedAt: string; timezone?: string; lang: string; issue: number; costUsd?: number },
  muteHref?: (story: Story) => string | undefined,
): NewspaperView {
  const byLink = new Map(Object.entries(images).map(([link, image]) => [canonical(link), image]));
  const legacy = !paper.sections.some((s) => s.stories.some((st) => st.importance));
  const placed = paper.sections.some((s) => s.stories.some((st) => st.place));

  const sections = paper.sections.map((section, i) => ({
    heading: plainHeading(section.heading ?? ""),
    stories: section.stories.map((story, j): NewsStory & { place?: Story["place"] } => {
      const source = story.source && isHttp(story.source) ? story.source : undefined;
      const image = source ? byLink.get(canonical(source)) : undefined;
      const importance = story.importance === 1 || story.importance === 3 ? story.importance : legacy && j === 0 ? 3 : 2;
      return {
        id: `s${i}-${j}`,
        kicker: story.kicker?.trim() || undefined,
        headline: story.display?.trim() || story.headline,
        spot: story.spot?.trim() || undefined,
        body: renderMarkdown(story.body),
        context: story.context ? renderMarkdown(story.context) : undefined,
        source,
        sourceHost: source && host(source),
        image: image && isHttp(image) ? image : undefined,
        importance,
        rating: story.rating,
        mute: muteHref?.(story),
        place: importance > 1 ? story.place : undefined,
      };
    }),
  }));

  // The candidates for page one when the model did not place a story: each section's cards in turn,
  // its biggest first, so the front page mixes sections the way an editor would.
  const cards = sections.map((s) => [...s.stories.filter((st) => st.importance > 1)].sort((a, b) => b.importance - a.importance));
  const roundRobin: NewsStory[] = [];
  for (let rank = 0; rank < Math.max(0, ...cards.map((c) => c.length)); rank++) for (const c of cards) if (c[rank]) roundRobin.push(c[rank]);

  const all = sections.flatMap((s) => s.stories);
  let lead = placed ? all.find((s) => s.place === "lead") : undefined;
  let top = placed ? all.filter((s) => s.place === "top" && s !== lead) : [];
  let front = placed ? all.filter((s) => (s.place === "front" || s.place === "lead") && s !== lead) : [];
  const unused = () => roundRobin.filter((s) => s !== lead && !top.includes(s) && !front.includes(s));
  lead ??= front.shift() ?? top.shift() ?? unused()[0];
  if (!placed) top = unused().slice(0, 3);
  top = top.slice(0, 3);
  // A front page needs a few stories under the manşet: fill it from the sections it does not show yet.
  const sectionOf = new Map(sections.flatMap((sec, i) => sec.stories.map((st) => [st as NewsStory, i] as const)));
  for (const s of unused()) {
    if (front.length >= 4) break;
    if (![lead, ...front].some((f) => f && sectionOf.get(f) === sectionOf.get(s))) front.push(s);
  }
  front = front.slice(0, 6);

  // Inner pages: every section in order, without the stories printed whole on page one. The sürmanşet
  // band only teases, so its stories are printed inside too.
  const onFront = new Set<NewsStory>([...(lead ? [lead] : []), ...front]);
  const pages: NewsPage[] = [];
  for (const section of sections) {
    const rest = section.stories.filter((s) => !onFront.has(s));
    if (!rest.length) continue;
    const number = pages.length + 2;
    const cardsHere = rest.filter((s) => s.importance > 1);
    const pageLead = cardsHere.find((s) => s.importance === 3) ?? cardsHere[0];
    for (const s of rest) s.page = number;
    pages.push({ number, heading: section.heading, lead: pageLead, stories: cardsHere.filter((s) => s !== pageLead), briefs: rest.filter((s) => s.importance === 1) });
  }
  const teasers = pages.map((p) => p.lead).filter((s): s is NewsStory => !!s && !top.includes(s)).slice(0, 4);

  return {
    name: meta.config.name ?? "Gazete",
    motto: meta.config.motto,
    date: longDate(meta.startedAt, meta.lang, meta.timezone),
    issue: meta.issue,
    price: meta.costUsd === undefined ? undefined : new Intl.NumberFormat(meta.lang, { style: "currency", currency: "USD" }).format(meta.costUsd),
    lead: lead && strip(lead),
    top: top.map(strip),
    front: front.map(strip),
    teasers: teasers.map(strip),
    pages: pages.map((p) => ({ ...p, lead: p.lead && strip(p.lead), stories: p.stories.map(strip), briefs: p.briefs.map(strip) })),
  };
}

// The place was only needed to lay out the page; the browser does not get it.
const strip = ({ place: _, ...story }: NewsStory & { place?: unknown }): NewsStory => story;

function longDate(iso: string, lang: string, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  try {
    return new Date(iso).toLocaleDateString(lang, { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleDateString(lang, opts);
  }
}
