import { Marked, type Token, type Tokens } from "marked";

// A paper is what a run produces and what the reading view shows: a masthead, sections, and stories
// with a headline, a markdown body, an optional background aside, a source link and an importance
// that sizes it on the page (3 leads a section, 2 is a card, 1 is a one-line brief). New runs return
// it as structured output against PAPER_SCHEMA; runs from before that are parsed out of their markdown
// with fromMarkdown, so both reach the site (app/server/paper-view.ts) the same way. A task with a
// newspaper layout (news, tech) also has the model lay out a printed front page: a kicker above the headline,
// a short display headline, a spot under it, and the story's place on page one (app/server/newspaper-view.ts).
export type Story = {
  headline: string;
  body: string;
  context?: string;
  source?: string;
  importance?: number;
  kicker?: string;
  display?: string;
  spot?: string;
  place?: Place;
  /** How much the story matters to the reader, 0-3: added after the run by src/rate.ts, not by the model, so not in PAPER_SCHEMA. */
  forYou?: number;
};
// Where a story sits on a printed front page: the lead headline under the masthead (manşet), the band
// above the masthead (sürmanşet), or elsewhere on page one. Left out, it is only on its section's page.
export type Place = "lead" | "top" | "front";
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
                kicker: { type: "string", description: "A few words set above the headline in a printed paper, naming the story's subject or angle. Only when the prompt asks for one." },
                display: { type: "string", description: "The headline as a printed paper would set it: short and strong, a few words. Only when the prompt asks for one." },
                spot: { type: "string", description: "The line under a printed headline that adds the key fact, one sentence, plain text, not a repeat of the body. Only when the prompt asks for one." },
                place: {
                  type: "string",
                  enum: ["lead", "top", "front"],
                  description: "Where the story sits on a printed front page: lead for the one main headline under the masthead, top for the one to three stories in the band above the masthead, front for the few others on page one. Left out for every other story. Only when the prompt asks for it.",
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

export function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Article links are matched to images without tracking parameters or a trailing slash, since the
// model sometimes copies a link with utm_ noise and sometimes without.
export function canonical(url: string) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export const isHttp = (url: string) => /^https?:\/\//i.test(url);

// A story's markdown as HTML, unsanitized: the site's CSP is what keeps a script in it from running.
export const renderMarkdown = (markdown: string) => md.parse(markdown, { async: false }) as string;

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
