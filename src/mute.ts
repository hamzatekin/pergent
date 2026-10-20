// The never-show list of a task with `"mute": true` (the ideas radar; pains, which it replaced, until
// 2026-10-20): products, sources or kinds of pain the reader does not want to see again, each a phrase.
// A phrase is matched as whole words, ignoring case, so "QuickBooks" matches "quickbooks-online" and
// "QuickBooks's" but not "QuickBooksy". The list lives in the database (db.ts); the runner writes it to
// muted.md in the run directory before the before scripts start, where previous.ts leaves out the
// stories that mention a phrase. The ideas radar sets aside the posts that mention one before its sort
// (src/ideas.ts) and its page hides the problems that do. For a paper, the server hides the stories that
// match, in old papers too. No imports from runner.ts or db.ts: the before scripts import this.
import type { Paper, Story } from "./paper.ts";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentions(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function mutedMarkdown(phrases: string[]): string {
  const list = phrases.length ? phrases.map((p) => `- ${p}`).join("\n") : "Nothing muted yet.";
  return `# Never show\n\n${list}\n`;
}

export function parseMuted(markdown: string): string[] {
  return [...markdown.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
}

// What a story's source is, in the words the fetch uses for it: the subreddit of a post, the forum or
// the job board. A muted name then matches the source's posts.
const FORUMS: Record<string, string> = { "freelancer.com": "Freelancer.com", "community.squareup.com": "Square Seller Community" };
export function sourceName(url: string | undefined): string | undefined {
  const u = url ? URL.parse(url) : null;
  if (!u) return undefined;
  const host = u.hostname.replace(/^www\./, "");
  if (host.endsWith("reddit.com")) {
    const sub = u.pathname.match(/^\/r\/([^/]+)/)?.[1];
    return sub && `r/${sub}`;
  }
  return FORUMS[host];
}

const storyText = (story: Story) => [story.headline, story.body, story.context, story.source, sourceName(story.source)].filter(Boolean).join("\n");

export function isMuted(story: Story, phrases: string[]): boolean {
  if (!phrases.length) return false;
  const text = storyText(story);
  return phrases.some((p) => mentions(text, p));
}

// The paper without the muted stories, and without sections left empty. The stories that stay are the
// same objects, so a caller can still find where each sat in the stored paper.
export function hideMuted(paper: Paper, phrases: string[]): { paper: Paper; hidden: number } {
  let hidden = 0;
  const sections = paper.sections
    .map((s) => {
      const stories = s.stories.filter((story) => !isMuted(story, phrases));
      hidden += s.stories.length - stories.length;
      return { ...s, stories };
    })
    .filter((s) => s.stories.length || s.lead);
  return { paper: { ...paper, sections }, hidden };
}

// What the never-show page offers for a story: its source, and its own headline, which tells the model
// to leave out pains like it. A product it names is typed in the page's field.
export function suggestions(story: Story): { phrase: string; label: string }[] {
  const source = sourceName(story.source);
  return [...(source ? [{ phrase: source, label: `Everything from ${source}` }] : []), { phrase: story.headline, label: "Pains like this one" }];
}
