// The never-show list of a task with `"mute": true` (pains): products, sources or kinds of pain the
// reader does not want to see again, each a phrase. A phrase is matched as whole words, ignoring case,
// so "QuickBooks" matches "quickbooks-online" and "QuickBooks's" but not "QuickBooksy". The list lives
// in the database (db.ts); the runner writes it to muted.md in the run directory before the before
// scripts start, where fetch-pains.ts drops the posts that mention a phrase and previous.ts the stories,
// and the prompt tells the model to leave out what is still about one. The server hides the stories
// that match, in old papers too. No imports from runner.ts or db.ts: the before scripts import this.
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

// The task's config; only fetch-pains.ts's App Store list is read, to name an app by its id.
type Config = { [key: string]: unknown };
const apps = (config: Config) => (config.pains as { appStore?: { id: number; name: string }[] } | undefined)?.appStore ?? [];

// What a story's source is, in the words the fetch uses for it: the app of an App Store review, the
// subreddit of a post, the forum or job board. A muted name then matches the source's posts.
export function sourceName(url: string | undefined, config: Config): { name: string; product: boolean } | undefined {
  const u = url ? URL.parse(url) : null;
  if (!u) return undefined;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "apps.apple.com") {
    const id = Number(u.pathname.match(/\/id(\d+)/)?.[1]);
    const app = apps(config).find((a) => a.id === id);
    return app && { name: app.name, product: true };
  }
  if (host === "apps.shopify.com") return { name: u.pathname.split("/")[1], product: true };
  if (host.endsWith("reddit.com")) {
    const sub = u.pathname.match(/^\/r\/([^/]+)/)?.[1];
    return sub ? { name: `r/${sub}`, product: false } : undefined;
  }
  const forums: Record<string, string> = {
    "freelancer.com": "Freelancer.com",
    "community.squareup.com": "Square Seller Community",
    "community.shopify.com": "Shopify Community",
    "forums.moneysavingexpert.com": "MoneySavingExpert",
  };
  return forums[host] ? { name: forums[host], product: false } : undefined;
}

const storyText = (story: Story, config: Config) =>
  [story.headline, story.body, story.context, story.source, sourceName(story.source, config)?.name].filter(Boolean).join("\n");

export function isMuted(story: Story, phrases: string[], config: Config): boolean {
  if (!phrases.length) return false;
  const text = storyText(story, config);
  return phrases.some((p) => mentions(text, p));
}

// The paper without the muted stories, and without sections left empty. The stories that stay are the
// same objects, so a caller can still find where each sat in the stored paper.
export function hideMuted(paper: Paper, phrases: string[], config: Config): { paper: Paper; hidden: number } {
  let hidden = 0;
  const sections = paper.sections
    .map((s) => {
      const stories = s.stories.filter((story) => !isMuted(story, phrases, config));
      hidden += s.stories.length - stories.length;
      return { ...s, stories };
    })
    .filter((s) => s.stories.length || s.lead);
  return { paper: { ...paper, sections }, hidden };
}

// What the never-show page offers for a story: its source's app or forum, the tracked apps it names,
// and the story's own headline, which tells the model to leave out pains like it.
export function suggestions(story: Story, config: Config): { phrase: string; label: string }[] {
  const out: { phrase: string; label: string }[] = [];
  const add = (phrase: string, label: string) => {
    if (!out.some((s) => s.phrase.toLowerCase() === phrase.toLowerCase())) out.push({ phrase, label });
  };
  const source = sourceName(story.source, config);
  if (source) add(source.name, source.product ? `Anything about ${source.name}` : `Everything from ${source.name}`);
  const text = [story.headline, story.body, story.context].filter(Boolean).join("\n");
  for (const app of apps(config)) if (mentions(text, app.name)) add(app.name, `Anything about ${app.name}`);
  add(story.headline, "Pains like this one");
  return out;
}
