// Collects what small business owners complain about into pains.md in the current directory, for the
// pains task: new posts from subreddits (their public RSS, which carries the whole post; the .json
// routes answer 403 since May 2026), new topics from Shopify Community categories (Discourse's
// /c/<id>.json, whose excerpt is the opening of the first post), and the newest 1 and 2 star reviews of
// paid Shopify apps (the app store's review pages). No keys. Reddit rate-limits RSS quickly, so the
// subreddits are fetched one at a time, a few seconds apart.
// Every item has an id; pains.json lists the ids delivered, and ids found in sibling runs' pains.json are
// skipped, so each post reaches the model once even when the windows overlap.
// Config from $TASK_DIR/task.json under "pains":
//   hours              how far back to take Reddit posts and forum topics (default 48)
//   reviewDays         how far back to take app reviews, which are rarer (default 14)
//   subreddits         subreddit names, without r/
//   shopifyCategories  Shopify Community category ids, with the name to show
//   apps               Shopify App Store slugs
//   perGroup           at most this many items per subreddit, category or app, newest first (default 30)
//   maxChars           size cap for pains.md (default 200000); bodies are cut shorter until it fits
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type Item = { id: string; group: string; when: Date; title: string; author: string; body: string; url: string };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const hours: number = config.pains?.hours ?? 48;
const reviewDays: number = config.pains?.reviewDays ?? 14;
const subreddits: string[] = config.pains?.subreddits ?? [];
const categories: Record<string, string> = config.pains?.shopifyCategories ?? {};
const apps: string[] = config.pains?.apps ?? [];
const perGroup: number = config.pains?.perGroup ?? 30;
const maxChars: number = config.pains?.maxChars ?? 200_000;
const BODY = 1200;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const since = Date.now() - hours * 3_600_000;
const reviewSince = Date.now() - reviewDays * 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: string[] = [];

// Ids delivered by earlier runs of this task.
const seen = new Set<string>();
const self = basename(resolve("."));
for (const dir of await readdir("..").catch(() => [] as string[])) {
  if (dir === self) continue;
  const ids = await readFile(join("..", dir, "pains.json"), "utf8").then(JSON.parse, () => []);
  for (const id of ids) seen.add(id);
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function text(html: string) {
  return decode(
    html
      .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function get(url: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 2) {
      await sleep(15_000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }
}

async function reddit(sub: string): Promise<Item[]> {
  const xml = await get(`https://www.reddit.com/r/${sub}/new/.rss?limit=100`);
  const items: Item[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = entry.match(/<id>([^<]+)<\/id>/)?.[1] ?? "";
    const url = entry.match(/<link href="([^"]+)"/)?.[1] ?? "";
    const when = new Date(entry.match(/<published>([^<]+)</)?.[1] ?? entry.match(/<updated>([^<]+)</)?.[1] ?? 0);
    const title = decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const author = entry.match(/<name>([^<]+)<\/name>/)?.[1] ?? "";
    // The content is the post's HTML, escaped once more for the feed.
    const body = text(decode(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "")).replace(/submitted by[\s\S]*$/, "").trim();
    items.push({ id: `reddit:${id}`, group: `Reddit r/${sub}`, when, title, author, body, url });
  }
  return items.filter((i) => i.when.getTime() >= since);
}

async function forum(id: string, name: string): Promise<Item[]> {
  const data = JSON.parse(await get(`https://community.shopify.com/c/${id}.json`));
  const items: Item[] = [];
  for (const t of data.topic_list?.topics ?? []) {
    if (t.pinned || t.closed) continue;
    items.push({
      id: `shopify-forum:${t.id}`,
      group: `Shopify Community: ${name}`,
      when: new Date(t.created_at),
      title: decode(t.title ?? ""),
      author: "",
      body: decode(t.excerpt ?? "").replace(/\s+/g, " ").trim(),
      url: `https://community.shopify.com/t/${t.slug}/${t.id}`,
    });
  }
  return items.filter((i) => i.when.getTime() >= since);
}

async function reviews(app: string): Promise<Item[]> {
  const page = `https://apps.shopify.com/${app}/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest`;
  const html = await get(page);
  const name = decode(html.match(/<title>([^<]*?)(?:\s*[|–-][^<]*)?<\/title>/)?.[1] ?? app).replace(/^Reviews?:\s*/i, "").replace(/ Reviews?$/i, "").trim();
  const items: Item[] = [];
  for (const block of html.split('data-merchant-review=""').slice(1)) {
    const id = block.match(/data-review-content-id="(\d+)"/)?.[1];
    const date = block.match(/>\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*</)?.[1];
    const stars = block.match(/aria-label="(\d) out of 5 stars"/)?.[1];
    const body = text(block.match(/data-truncate-content-copy[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");
    // After the review text come the store's name, its country and how long it has used the app.
    const facts = text(block.replace(/<svg[\s\S]*?<\/svg>/g, "").split(/data-truncate-content-copy/)[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "Show more" && !body.includes(l))
      .slice(0, 3)
      .join(", ");
    if (!id || !date || !body) continue;
    items.push({
      id: `shopify-review:${id}`,
      group: `Shopify App Store: ${name} (1 and 2 star reviews)`,
      when: new Date(`${date} 12:00 UTC`),
      title: `${stars} star review of ${name}`,
      author: facts,
      body,
      url: `${page}#${id}`,
    });
  }
  return items.filter((i) => i.when.getTime() >= reviewSince);
}

const found: Item[] = [];
async function collect(label: string, run: () => Promise<Item[]>) {
  try {
    const items = await run();
    found.push(...items);
    log.push(`${label}: ${items.length}`);
  } catch (err) {
    log.push(`${label}: failed, ${err instanceof Error ? err.message : err}`);
  }
}

// Reddit one at a time, spaced out; the forum and the app store alongside it.
await Promise.all([
  (async () => {
    for (const [i, sub] of subreddits.entries()) {
      if (i) await sleep(4000);
      await collect(`r/${sub}`, () => reddit(sub));
    }
  })(),
  (async () => {
    for (const [id, name] of Object.entries(categories)) await collect(`shopify forum ${name}`, () => forum(id, name));
    for (const app of apps) await collect(`app ${app}`, () => reviews(app));
  })(),
]);

const fresh = found.filter((i) => !seen.has(i.id) && (i.body || i.title));
const groups = new Map<string, Item[]>();
for (const i of fresh.sort((a, b) => b.when.getTime() - a.when.getTime())) {
  if (!groups.has(i.group)) groups.set(i.group, []);
  if (groups.get(i.group)!.length < perGroup) groups.get(i.group)!.push(i);
}
const kept = [...groups.values()].flat();

function render(limit: number) {
  const indent = (s: string) => s.split("\n").map((l) => `  ${l}`).join("\n");
  const cut = (s: string) => (s.length > limit ? `${s.slice(0, limit)}…` : s);
  const parts = [
    `# What small business owners posted (fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)\n\n${kept.length} new posts, newest first in each group.`,
  ];
  for (const [group, items] of groups) {
    parts.push(`## ${group}`);
    for (const i of items) {
      const by = i.author ? ` · ${i.author}` : "";
      parts.push(`- ${i.when.toISOString().slice(0, 10)}${by}\n${indent(i.title)}${i.body ? `\n${indent(cut(i.body))}` : ""}\n  ${i.url}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

// Cut the bodies shorter until the file fits.
let limit = BODY;
let out = render(limit);
while (out.length > maxChars && limit > 200) out = render((limit -= 100));

await writeFile("pains.md", out);
await writeFile("pains.json", JSON.stringify(kept.map((i) => i.id)));
await writeFile("pains.log", log.join("\n") + "\n");
console.log(`pains.md: ${kept.length} new items (${found.length - fresh.length} seen before, ${fresh.length - kept.length} over the per-group cap), ${out.length} chars, bodies cut at ${limit}`);
console.log(log.join("\n"));
