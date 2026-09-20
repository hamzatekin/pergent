// Rebuilds the conversations behind the "fighting about" items of the latest digest run, for the
// fights task. Runs in the fights run directory; the digest task's runs are siblings under ../../.
// Config comes from $TASK_DIR/task.json under "fights":
//   source       the digest task whose runs are read (default "tech")
//   section      text the digest's "## " heading must contain (default "fighting about")
//   maxChars     size cap for fights.md (default 60000)
//   perItemChars size cap per item (default 9000)
// Writes fights.md (one "## " per item: the digest's own words, the post, what it responds to, replies
// and quote posts from the tracked accounts in the digest run's posts.json, one level down from each
// quote) and source.json (which digest run and items this covers). Exits 1 when a sibling run already
// covered that digest run, so a catch-up run never repeats a deep dive.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PostRecord } from "./fetch-x.ts";

type Status = {
  id: string;
  url: string;
  text: string;
  created_timestamp: number;
  likes: number;
  replies: number;
  quotes?: number;
  author: { screen_name: string };
  replying_to?: { screen_name: string; status?: string } | null;
  quote?: Status | null;
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const source: string = config.fights?.source ?? "tech";
const sectionText: string = (config.fights?.section ?? "fighting about").toLowerCase();
const maxChars: number = config.fights?.maxChars ?? 60_000;
const perItemChars: number = config.fights?.perItemChars ?? 9_000;
const runsDir = resolve(process.cwd(), "../..");

async function readJson<T>(path: string): Promise<T | null> {
  return readFile(path, "utf8").then(JSON.parse, () => null);
}

// Latest ok run of the digest task that has an output.
async function latestSourceRun(): Promise<{ runId: string; output: string } | null> {
  const dir = join(runsDir, source);
  const ids = (await readdir(dir).catch(() => [] as string[])).sort().reverse();
  for (const runId of ids) {
    const meta = await readJson<{ status?: string }>(join(dir, runId, "meta.json"));
    if (meta?.status !== "ok") continue;
    const output = await readFile(join(dir, runId, "output.md"), "utf8").catch(() => "");
    if (output.trim()) return { runId, output };
  }
  return null;
}

const digest = await latestSourceRun();
if (!digest) {
  console.log(`no finished ${source} run to dive into`);
  process.exit(1);
}

// A sibling fights run that already covered this digest run means there is nothing new to do.
const mine = resolve(process.cwd(), "..");
for (const id of await readdir(mine)) {
  if (resolve(mine, id) === process.cwd()) continue;
  const prev = await readJson<{ runId?: string }>(join(mine, id, "source.json"));
  if (prev?.runId === digest.runId) {
    console.log(`${source} run ${digest.runId} was already covered by fights run ${id}; nothing to do`);
    process.exit(1);
  }
}

// The section's "### " items: heading, the digest's own text, and the bare source URL.
type Item = { title: string; body: string; url: string };
function parseItems(output: string): Item[] {
  const lines = output.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.toLowerCase().includes(sectionText));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  const items: Item[] = [];
  let item: { title: string; lines: string[] } | undefined;
  const flush = () => {
    if (!item) return;
    const url = item.lines.filter((l) => /^https?:\/\/\S+$/.test(l.trim())).at(-1)?.trim();
    const body = item.lines.filter((l) => !/^https?:\/\/\S+$/.test(l.trim())).join("\n").trim();
    if (url) items.push({ title: item.title, body, url });
    item = undefined;
  };
  for (const line of lines.slice(start + 1, end)) {
    if (line.startsWith("### ")) {
      flush();
      item = { title: line.slice(4).trim(), lines: [] };
    } else if (item) item.lines.push(line);
  }
  flush();
  // The digest sometimes files two angles of one post as two items; one dive per post.
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.url) && seen.add(i.url));
}

const items = parseItems(digest.output);
if (!items.length) {
  console.log(`no "${sectionText}" items in ${source} run ${digest.runId}`);
  process.exit(1);
}

const posts = (await readJson<PostRecord[]>(join(runsDir, source, digest.runId, "posts.json"))) ?? [];
if (!posts.length) console.log(`warning: no posts.json in ${source} run ${digest.runId}; conversations will be empty`);
const repliesTo = new Map<string, PostRecord[]>();
const quotesOf = new Map<string, PostRecord[]>();
for (const p of posts) {
  if (p.replyTo) repliesTo.set(p.replyTo.id, [...(repliesTo.get(p.replyTo.id) ?? []), p]);
  if (p.quote) quotesOf.set(p.quote.id, [...(quotesOf.get(p.quote.id) ?? []), p]);
}
const byLikes = (a: PostRecord, b: PostRecord) => b.likes - a.likes;
const trackedHandles = new Set(posts.map((p) => p.handle.toLowerCase())).size;

async function fetchStatus(id: string): Promise<Status | null> {
  try {
    const res = await fetch(`https://api.fxtwitter.com/2/status/${id}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return ((await res.json()) as { status?: Status }).status ?? null;
  } catch {
    return null;
  }
}

const statusId = (url: string) => url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/)?.[1];
const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
};
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const statusLine = (s: Status) =>
  `@${s.author.screen_name} · ${s.likes} likes · ${s.replies} replies · ${s.quotes ?? 0} quote posts · ${when(new Date(s.created_timestamp * 1000).toISOString())} UTC\n${clip(s.text, 1200)}\n${s.url}`;
const postLine = (p: PostRecord, max: number) => `- @${p.author} · ${p.likes} likes · ${p.replies} replies\n  ${clip(p.text, max)}\n  ${p.url}`;

// Limits shrink until an item fits perItemChars.
type Limits = { replies: number; quotes: number; sub: number; text: number };

function renderItem(item: Item, seed: Status | null, parent: Status | null, l: Limits): string {
  const parts = [`## ${item.title}`, `The digest said:\n${item.body}\n${item.url}`];
  if (!seed) {
    parts.push(`### No conversation data\nThe source is ${statusId(item.url) ? "a post that could not be fetched" : "an article, not a post"}, so there are no replies or quote posts here. Explain the topic from the digest's words and, if needed, a search.`);
    return parts.join("\n\n");
  }
  parts.push(`### The post\n${statusLine(seed)}`);
  if (parent) parts.push(`### What it ${seed.replying_to?.status === parent.id ? "replies to" : "quotes"}\n${statusLine(parent)}`);
  const own = (repliesTo.get(seed.id) ?? []).filter((p) => p.author.toLowerCase() === seed.author.screen_name.toLowerCase());
  if (own.length) parts.push(`### The author's own follow-ups\n${own.map((p) => postLine(p, l.text)).join("\n\n")}`);
  const replies = (repliesTo.get(seed.id) ?? []).filter((p) => !own.includes(p)).sort(byLikes);
  parts.push(
    `### Replies from tracked accounts (${replies.length} of ${seed.replies} public replies)\n${replies.slice(0, l.replies).map((p) => postLine(p, l.text)).join("\n\n") || "(none)"}`,
  );
  const quotes = (quotesOf.get(seed.id) ?? []).sort(byLikes);
  const quoteBlocks = quotes.slice(0, l.quotes).map((q) => {
    const block = [`#### @${q.author} · ${q.likes} likes · ${q.replies} replies · ${q.quotes} quote posts\n${clip(q.text, 600)}\n${q.url}`];
    const sub = (repliesTo.get(q.id) ?? []).sort(byLikes).slice(0, l.sub);
    if (sub.length) block.push(`Replies to this quote post from tracked accounts:\n${sub.map((p) => postLine(p, l.text)).join("\n")}`);
    const subq = (quotesOf.get(q.id) ?? []).sort(byLikes).slice(0, l.sub);
    if (subq.length) block.push(`Quote posts of this quote post from tracked accounts:\n${subq.map((p) => postLine(p, l.text)).join("\n")}`);
    return block.join("\n\n");
  });
  parts.push(`### Quote posts from tracked accounts (${quotes.length} of ${seed.quotes ?? 0} public quote posts)\n${quoteBlocks.join("\n\n") || "(none)"}`);
  return parts.join("\n\n");
}

const rendered: string[] = [];
let fetched = 0;
for (const item of items) {
  const id = statusId(item.url);
  const seed = id ? await fetchStatus(id) : null;
  if (seed) fetched++;
  const parentId = seed?.replying_to?.status ?? seed?.quote?.id;
  const parent = seed?.quote ?? (parentId ? await fetchStatus(parentId) : null);
  let limits: Limits = { replies: 15, quotes: 10, sub: 5, text: 400 };
  let text = renderItem(item, seed, parent, limits);
  while (text.length > perItemChars && limits.replies > 2) {
    limits = { replies: Math.ceil(limits.replies / 2), quotes: Math.ceil(limits.quotes / 2), sub: Math.ceil(limits.sub / 2), text: Math.max(200, limits.text - 100) };
    text = renderItem(item, seed, parent, limits);
  }
  rendered.push(text);
}

const header = `# The fights behind the ${source} digest of ${when(digest.runId.replace(/-(\d\d)-(\d\d)-(\d+)Z$/, ":$1:$2.$3Z"))}

${items.length} items from the digest's "${sectionText}" section. For each: what the digest said, the post itself with its full public counts, what it responds to, and the replies and quote posts that came from the ${trackedHandles} tracked accounts, one level down from each quote post. Replies from anyone outside those accounts are not here, so the counts show how much of the conversation this covers. Post text is cut at 600 characters, replies shorter.`;
let out = [header, ...rendered].join("\n\n") + "\n";
if (out.length > maxChars) out = out.slice(0, maxChars - 40) + "\n\n(cut to fit the size cap)\n";
await writeFile("fights.md", out);
await writeFile("source.json", JSON.stringify({ task: source, runId: digest.runId, items: items.map((i) => ({ title: i.title, url: i.url })) }, null, 2));
console.log(`fights.md: ${items.length} items from ${source} run ${digest.runId}, ${fetched} posts fetched, ${posts.length} tracked posts indexed, ${out.length} chars`);
