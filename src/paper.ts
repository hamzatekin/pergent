import { Marked, type Token, type Tokens } from "marked";

// A paper is what a run produces and what the reading view shows: a masthead, sections, and stories
// with a headline, a markdown body, an optional background aside, a source link and an importance
// that sizes it on the page (3 leads a section, 2 is a card, 1 is a one-line brief). New runs return
// it as structured output against PAPER_SCHEMA; runs from before that are parsed out of their markdown
// with fromMarkdown, so both go through the one renderer below.
export type Story = { headline: string; body: string; context?: string; source?: string; importance?: number; rating?: Rating };
// Added after the run by src/rate.ts, not by the model: 0-10 overall and per part (sourcing,
// neutrality, substance). Not in PAPER_SCHEMA.
export type Rating = { score: number; parts: Record<string, number> };
export type Section = { heading?: string; lead?: string; stories: Story[] };
export type Paper = { title?: string; sections: Section[] };

// What the prompt's per-task labels are called in task.json: the tab (`label`) and the handle of the
// folded background aside (`contextLabel`, "Context" or "Ne olmuştu?") and the heading of a section's
// briefs (`briefsLabel`, "In brief" or "Kısaca").
export type PaperLabels = { label?: string; contextLabel?: string; briefsLabel?: string };

export const PAPER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "sections"],
  properties: {
    title: { type: "string", description: "The paper's masthead: one line, plain text." },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "stories"],
        properties: {
          heading: { type: "string", description: "Section heading, one line, plain text." },
          lead: { type: "string", description: "Markdown shown before the section's stories, such as a bullet list. Only when the prompt asks for one." },
          stories: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["headline", "body"],
              properties: {
                headline: { type: "string", description: "One line, plain text." },
                body: { type: "string", description: "A few sentences, markdown." },
                context: { type: "string", description: "Background for a reader who missed the earlier developments, a few sentences, markdown. Only when the prompt asks for one and it is needed." },
                source: { type: "string", description: "The URL this story comes from, copied from the input files." },
                importance: {
                  type: "integer",
                  enum: [1, 2, 3],
                  description: "How big the story is on the page: 3 for the one or two stories that lead the section, 2 for a normal story, 1 for a brief, a one-line item worth knowing but not a paragraph. Left out, it is 2.",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

// A light check that structured output has the shape above; the model side is held to the schema,
// this catches a missing or foreign object before it is stored.
export function parsePaper(value: unknown): Paper | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as Paper).sections)) return null;
  const paper = value as Paper;
  for (const section of paper.sections) {
    if (!section || typeof section !== "object" || !Array.isArray(section.stories)) return null;
    for (const story of section.stories) if (typeof story?.headline !== "string" || typeof story.body !== "string") return null;
  }
  return paper;
}

// Bare URLs on their own line (how the prompts ask for sources) render as a small "host ↗" chip
// instead of a wall of link text, also inside story bodies.
const chip = (href: string) => `<a class="src" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(host(href))} ↗</a>`;
const md = new Marked({
  renderer: {
    link({ href, text }) {
      return text === href ? chip(href) : false;
    },
  },
});

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Article links are matched to images without tracking parameters or a trailing slash, since the
// model sometimes copies a link with utm_ noise and sometimes without.
function canonical(url: string) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

// The rating: the overall number large, then each part (src/rate.ts's questions) on its own line as a
// name, a ten-cell bar and its number, with what it measures in the tooltip. Cells and colour are
// classes, since the CSP allows no inline style.
const PARTS: [key: string, name: string, meaning: string][] = [
  ["sourcing", "Sourcing", "How well the claim is backed: a rumour, one account, a named outlet, or a primary source"],
  ["neutrality", "Neutral tone", "How plain the original is: hype or propaganda, spun, mostly factual, or plain"],
  ["substance", "Substance", "How much the story gives you: nothing concrete, one fact, some detail, or specifics and why it matters"],
];
const level = (score: number) => (score >= 7 ? "high" : score >= 4.5 ? "mid" : "low");
const cells = (score: number) => Array.from({ length: 10 }, (_, i) => `<i${i < Math.round(score) ? ' class="on"' : ""}></i>`).join("");
function meter(rating: Rating) {
  const parts = PARTS.filter(([key]) => typeof rating.parts[key] === "number").map(([key, name, meaning]) => {
    const v = rating.parts[key];
    return `<span class="part" data-level="${level(v)}" title="${escapeHtml(meaning)}"><span class="name">${name}</span><span class="cells">${cells(v)}</span><span class="num">${v.toFixed(1)}</span></span>`;
  });
  return `<div class="rating" data-level="${level(rating.score)}"><span class="overall" title="Rated by Jev, 0-10"><span class="score">${rating.score.toFixed(1)}</span><span class="of">/10</span></span><span class="parts">${parts.join("")}</span></div>`;
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);
const render = (markdown: string) => md.parse(markdown, { async: false }) as string;

// A story's size on the page. A run from before the field exists has none, so its first story per
// section leads and the rest are cards, which is the order the prompts have always implied.
function importance(story: Story, index: number, legacy: boolean) {
  return story.importance === 1 || story.importance === 3 ? story.importance : legacy && index === 0 ? 3 : 2;
}

// The paper as HTML. Headlines and headings are text; bodies, leads and asides are the model's
// markdown, rendered unsanitized (the server's CSP is what keeps a script in it from running).
export function renderPaper(paper: Paper, images: Record<string, string> = {}, labels: PaperLabels = {}) {
  const byLink = new Map(Object.entries(images).map(([link, image]) => [canonical(link), image]));
  const legacy = !paper.sections.some((s) => s.stories.some((st) => st.importance));
  const out: string[] = ['<div class="paper">'];
  if (paper.title) out.push(`<h1 class="masthead">${escapeHtml(paper.title)}</h1>`);
  const inner = (story: Story) => {
    const parts = [`<h3>${escapeHtml(story.headline)}</h3>`, render(story.body)];
    if (story.context) {
      parts.push(`<details class="aside"><summary>${escapeHtml(labels.contextLabel ?? "Context")}</summary>${render(story.context)}</details>`);
    }
    if (story.source && isHttp(story.source)) parts.push(`<p class="foot">${chip(story.source)}</p>`);
    if (story.rating) parts.push(meter(story.rating));
    return parts.join("\n");
  };
  for (const section of paper.sections) {
    out.push('<section class="section">');
    if (section.heading) out.push(`<h2 class="section-head">${escapeHtml(section.heading)}</h2>`);
    if (section.lead) out.push(`<div class="prose lead">${render(section.lead)}</div>`);
    // Cards sit in a grid on a wide screen, a lead story two columns wide (styles.css); one column on a
    // phone. The section's briefs follow the grid as one band of short lines, in the order written.
    const sized = section.stories.map((story, i) => ({ story, importance: importance(story, i, legacy) }));
    const cards = sized.filter((s) => s.importance > 1);
    const briefs = sized.filter((s) => s.importance === 1);
    if (cards.length) out.push('<div class="stories">');
    for (const { story, importance } of cards) {
      const image = story.source ? byLink.get(canonical(story.source)) : undefined;
      out.push(`<article class="story" data-importance="${importance}">`);
      // A feed thumbnail too small for the card looks worse than no image; app.js drops those on load.
      if (image && isHttp(image)) out.push(`<img class="story-image" src="${escapeHtml(image)}" alt="" loading="lazy">`);
      out.push(`<div class="prose">\n${inner(story)}\n</div></article>`);
    }
    if (cards.length) out.push("</div>");
    if (briefs.length) {
      out.push(`<div class="briefs"><h4 class="briefs-head">${escapeHtml(labels.briefsLabel ?? "In brief")}</h4>`);
      for (const { story } of briefs) out.push(`<article class="brief prose">\n${inner(story)}\n</article>`);
      out.push("</div>");
    }
    out.push("</section>");
  }
  out.push("</div>");
  return out.join("\n");
}

// The paper as the markdown the prompts used to ask for, kept in each run directory as output.md so
// a run stays readable with cat and diffable in git.
export function toMarkdown(paper: Paper, labels: PaperLabels = {}) {
  const out: string[] = [];
  if (paper.title) out.push(`# ${paper.title}`);
  for (const section of paper.sections) {
    if (section.heading) out.push(`## ${section.heading}`);
    if (section.lead) out.push(section.lead.trim());
    for (const story of section.stories) {
      out.push(`### ${story.headline}\n${story.body.trim()}`);
      if (story.context) out.push(`> **${labels.contextLabel ?? "Context"}:** ${story.context.trim().replace(/\n/g, "\n> ")}`);
      if (story.source) out.push(story.source);
    }
  }
  return out.join("\n\n") + "\n";
}

// Runs from before structured output: an h1 masthead, h2 sections, h3 stories. Tokens before a
// section's first story (a TL;DR list, say) are the section's lead. Inside a story, a blockquote that
// opens with a bold label is the background aside and a paragraph that is one bare URL is the source.
export function fromMarkdown(markdown: string): Paper {
  const paper: Paper = { sections: [] };
  let section: Section | undefined;
  let story: { headline: string; tokens: Token[] } | undefined;
  const stories: { section: Section; story: typeof story & {} }[] = [];
  const open = () => {
    if (!section) paper.sections.push((section = { stories: [] }));
    return section;
  };
  for (const token of md.lexer(markdown)) {
    const heading = token.type === "heading" ? (token as Tokens.Heading) : null;
    if (heading && heading.depth === 1 && paper.title === undefined) {
      paper.title = heading.text;
    } else if (heading && heading.depth <= 2) {
      paper.sections.push((section = { heading: heading.text, stories: [] }));
      story = undefined;
    } else if (heading && heading.depth === 3) {
      story = { headline: heading.text, tokens: [] };
      stories.push({ section: open(), story });
    } else if (story) {
      story.tokens.push(token);
    } else if (token.type !== "space") {
      const s = open();
      s.lead = (s.lead ?? "") + token.raw;
    }
  }
  for (const { section, story: s } of stories) {
    const out: Story = { headline: s.headline, body: "" };
    for (const token of s.tokens) {
      const link = token.type === "paragraph" && token.tokens?.length === 1 && token.tokens[0].type === "link" ? (token.tokens[0] as Tokens.Link) : null;
      const quote = token.type === "blockquote" ? token.raw.replace(/^> ?/gm, "").match(/^\*\*([^*]+?):?\*\*\s*([\s\S]*)$/) : null;
      if (link && link.text === link.href && !out.source) out.source = link.href;
      else if (quote && !out.context) out.context = quote[2].trim();
      else out.body += token.raw;
    }
    out.body = out.body.trim();
    section.stories.push(out);
  }
  for (const section of paper.sections) if (section.lead) section.lead = section.lead.trim();
  return paper;
}
