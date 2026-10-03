// Collects what small business owners complain about, and what they pay others to do by hand, into
// pains.md in the current directory, for the pains task. No keys. The sources, each under its own key in
// $TASK_DIR/task.json's "pains":
//   reddit        a list of requests, most important first, each a multireddit (`subs` joined with +)
//                 read through its public RSS, which carries the whole post (the .json routes answer 403
//                 since May 2026): its newest 100 posts, or with `search` the newest 100 of the last week
//                 matching that query. Logged out, Reddit allows one RSS request a minute
//                 (x-ratelimit-remaining is 0 after one), so the requests wait for x-ratelimit-reset and
//                 the list is kept to the three or so that fit in the time budget.
//   appStore      business apps on Apple's App Store, `{ id, name, countries }`: their 1 and 2 star
//                 reviews from the store's customer reviews RSS (JSON), per country
//   freelancer    Freelancer.com's open projects API: `queries`, kept to `currencies` (USD and GBP, for
//                 UK and US clients), `perQuery` newest each; a job paying someone to do a chore by hand
//                 is the plainest sign the chore is worth money
//   khoros        Khoros communities with the public LiQL API, `{ host, name, skipBoards }` (Square's
//                 seller community): their newest 100 topics, grouped by board
//   vanilla       Vanilla forums with the public v2 API, `{ host, name, categories: { id: name } }`
//                 (MoneySavingExpert): the newest 30 discussions of each category
//   shopifyCategories  Shopify Community (Discourse) category ids, with the name to show: the newest
//                 topics through /c/<id>.json, whose excerpt is the opening of the first post
//   apps          Shopify App Store slugs: their newest 1 and 2 star reviews, parsed from the HTML
// Windows: `hours` (default 48) for the busy sources; `reviewDays` (default 14) for app reviews and the
// quiet forums (khoros, vanilla); Reddit's searches cover the week. Every item has an id; pains.json
// lists the ids delivered, and ids found in sibling runs' pains.json are skipped, so each post reaches
// the model once even when the windows overlap. Other settings:
//   perGroup           at most this many items per group (subreddit, app, board…), newest first (default 30)
//   maxChars           size cap for pains.md (default 260000); bodies are cut shorter until it fits
//   budgetSeconds      when to stop starting new fetches (default 180), so the script ends well inside the
//                      before command's 5 minutes; what was fetched by then is written
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type Item = { id: string; group: string; when: Date; title: string; author: string; body: string; url: string };
type RedditRequest = { subs: string[]; search?: string };
type App = { id: number; name: string; countries: string[] };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const pains = config.pains ?? {};
const hours: number = pains.hours ?? 48;
const reviewDays: number = pains.reviewDays ?? 14;
const perGroup: number = pains.perGroup ?? 30;
const maxChars: number = pains.maxChars ?? 260_000;
const BODY = 1200;
const deadline = Date.now() + (pains.budgetSeconds ?? 180) * 1000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const since = Date.now() - hours * 3_600_000;
const reviewSince = Date.now() - reviewDays * 86_400_000;
const weekSince = Date.now() - 7 * 86_400_000;
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
    .replace(/&#x2F;/gi, "/")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function text(html: string) {
  return decode(
    html
      .replace(/<(br|\/p|p|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// One retry on 429, and only when there is time for it.
async function get(url: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429 && attempt < 1 && Date.now() + 25_000 < deadline) {
      await sleep(10_000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }
}

// Reddit's requests go one after another, each waiting until the rate limit window of the last one has
// reset. A wait that would run past the budget skips the request instead.
let redditReadyAt = 0;
async function redditGet(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const wait = redditReadyAt - Date.now();
    if (wait > 0) {
      if (Date.now() + wait + 15_000 > deadline) throw new Error(`skipped, Reddit's rate limit resets after the time budget`);
      await sleep(wait);
    }
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? 1);
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 60);
    if (remaining < 1 || res.status === 429) redditReadyAt = Date.now() + (reset + 2) * 1000;
    if (res.status === 429 && attempt < 1) continue;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }
}

async function reddit(req: RedditRequest): Promise<Item[]> {
  const multi = req.subs.join("+");
  const url = req.search
    ? `https://www.reddit.com/r/${multi}/search.rss?${new URLSearchParams({ q: req.search, restrict_sr: "1", sort: "new", t: "week", limit: "100" })}`
    : `https://www.reddit.com/r/${multi}/new/.rss?limit=100`;
  const xml = await redditGet(url);
  const items: Item[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = entry.match(/<id>([^<]+)<\/id>/)?.[1] ?? "";
    const sub = entry.match(/<category term="([^"]+)"/)?.[1] ?? "?";
    const url = entry.match(/<link href="([^"]+)"/)?.[1] ?? "";
    const when = new Date(entry.match(/<published>([^<]+)</)?.[1] ?? entry.match(/<updated>([^<]+)</)?.[1] ?? 0);
    const title = decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const author = entry.match(/<name>([^<]+)<\/name>/)?.[1] ?? "";
    // The content is the post's HTML, escaped once more for the feed.
    const body = text(decode(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "")).replace(/submitted by[\s\S]*$/, "").trim();
    items.push({ id: `reddit:${id}`, group: `Reddit r/${sub}`, when, title, author, body, url });
  }
  return items.filter((i) => i.when.getTime() >= (req.search ? weekSince : since));
}

async function appStore(app: App, country: string): Promise<Item[]> {
  const data = JSON.parse(await get(`https://itunes.apple.com/${country}/rss/customerreviews/id=${app.id}/sortby=mostrecent/json`));
  const entries = [data.feed?.entry ?? []].flat();
  const items: Item[] = [];
  for (const e of entries) {
    const rating = Number(e["im:rating"]?.label);
    if (!rating || rating > 2) continue;
    items.push({
      id: `appstore:${e.id?.label}`,
      group: `App Store: ${app.name} (1 and 2 star reviews)`,
      when: new Date(e.updated?.label ?? 0),
      title: `${rating} star review: ${e.title?.label ?? ""}`,
      author: `${country.toUpperCase()}, version ${e["im:version"]?.label ?? "?"}`,
      body: e.content?.label ?? "",
      url: `https://apps.apple.com/${country}/app/id${app.id}?see-all=reviews#${e.id?.label}`,
    });
  }
  return items.filter((i) => i.when.getTime() >= reviewSince);
}

type Project = {
  id: number;
  seo_url: string;
  title: string;
  time_submitted: number;
  type: string;
  description?: string;
  preview_description?: string;
  budget: { minimum?: number; maximum?: number };
  currency: { code: string };
};

async function freelancer(query: string): Promise<Item[]> {
  const currencies: string[] = pains.freelancer?.currencies ?? ["USD", "GBP"];
  const params = new URLSearchParams({
    query,
    limit: "50",
    from_time: String(Math.floor(since / 1000)),
    full_description: "true",
    compact: "true",
  });
  const data = JSON.parse(await get(`https://www.freelancer.com/api/projects/0.1/projects/active/?${params}`));
  const projects: Project[] = data.result?.projects ?? [];
  return projects
    .filter((p) => currencies.includes(p.currency.code))
    .slice(0, pains.freelancer?.perQuery ?? 6)
    .map((p) => ({
      id: `freelancer:${p.id}`,
      group: `Freelancer.com job posts for "${query}"`,
      when: new Date(p.time_submitted * 1000),
      title: p.title,
      author: `budget ${p.budget.minimum ?? "?"} to ${p.budget.maximum ?? "?"} ${p.currency.code}${p.type === "hourly" ? " an hour" : ""}`,
      body: (p.description ?? p.preview_description ?? "").trim(),
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
    }));
}

type KhorosMessage = { id: string; subject: string; body: string; post_time: string; view_href: string; board: { id: string } };

async function khoros(host: string, name: string, skipBoards: string[] = []): Promise<Item[]> {
  const q = "SELECT id, subject, body, post_time, view_href, board.id FROM messages WHERE depth = 0 ORDER BY post_time DESC LIMIT 100";
  const data = JSON.parse(await get(`https://${host}/api/2.0/search?${new URLSearchParams({ q })}`));
  const messages: KhorosMessage[] = data.data?.items ?? [];
  return messages
    .filter((m) => !skipBoards.includes(m.board.id))
    .map((m) => ({
      id: `${host}:${m.id}`,
      group: `${name}: ${m.board.id.replace(/-/g, " ")}`,
      when: new Date(m.post_time),
      title: decode(m.subject),
      author: "",
      body: text(m.body ?? ""),
      url: m.view_href,
    }))
    .filter((i) => i.when.getTime() >= reviewSince);
}

type Discussion = { discussionID: number; name: string; body: string; dateInserted: string; url: string };

async function vanilla(host: string, name: string, categoryID: string, category: string): Promise<Item[]> {
  const params = new URLSearchParams({ categoryID, limit: "30", sort: "-dateInserted" });
  const discussions: Discussion[] = JSON.parse(await get(`https://${host}/api/v2/discussions?${params}`));
  return discussions
    .map((d) => ({
      id: `${host}:${d.discussionID}`,
      group: `${name}: ${category}`,
      when: new Date(d.dateInserted),
      title: decode(d.name),
      author: "",
      body: text(d.body ?? ""),
      url: d.url,
    }))
    .filter((i) => i.when.getTime() >= reviewSince);
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
// Each result is printed as it comes, so before.log shows how far a run got even when it is stopped.
async function collect(label: string, run: () => Promise<Item[]>) {
  let line: string;
  let ok = false;
  if (Date.now() > deadline) line = `${label}: skipped, out of time`;
  else
    try {
      const items = await run();
      found.push(...items);
      line = `${label}: ${items.length}`;
      ok = true;
    } catch (err) {
      line = `${label}: failed, ${err instanceof Error ? err.message : err}`;
    }
  log.push(line);
  console.log(line);
  return ok;
}

// Everything but Reddit, 6 at a time.
const jobs: [string, () => Promise<Item[]>][] = [
  ...(pains.appStore ?? []).flatMap((a: App) => a.countries.map((c) => [`app store ${a.name} ${c}`, () => appStore(a, c)])),
  ...(pains.freelancer?.queries ?? []).map((q: string) => [`freelancer "${q}"`, () => freelancer(q)]),
  ...(pains.khoros ?? []).map((k: { host: string; name: string; skipBoards?: string[] }) => [k.name, () => khoros(k.host, k.name, k.skipBoards)]),
  ...(pains.vanilla ?? []).flatMap((v: { host: string; name: string; categories: Record<string, string> }) =>
    Object.entries(v.categories).map(([id, c]) => [`${v.name} ${c}`, () => vanilla(v.host, v.name, id, c)]),
  ),
  ...Object.entries(pains.shopifyCategories ?? {}).map(([id, name]) => [`shopify forum ${name}`, () => forum(id, name as string)]),
  ...(pains.apps ?? []).map((app: string) => [`shopify app ${app}`, () => reviews(app)]),
];

await Promise.all([
  (async () => {
    // A 403 means Reddit is refusing this server, not rate-limiting it; the rest would fail too.
    let refused = false;
    for (const req of (pains.reddit ?? []) as RedditRequest[]) {
      const label = req.search ? `reddit search in ${req.subs.length} subreddits` : `reddit newest in ${req.subs.length} subreddits`;
      if (refused) {
        log.push(`${label}: skipped, Reddit refused the last request`);
        console.log(log.at(-1));
        continue;
      }
      refused = !(await collect(label, () => reddit(req))) && log.at(-1)!.includes("403");
    }
  })(),
  ...Array.from({ length: 6 }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await collect(...job);
  }),
]);

// New items only, each once (the same post can come from two queries or feeds).
const fresh: Item[] = [];
const ids = new Set<string>();
for (const i of found.sort((a, b) => b.when.getTime() - a.when.getTime())) {
  if (seen.has(i.id) || ids.has(i.id) || !(i.body || i.title)) continue;
  ids.add(i.id);
  fresh.push(i);
}
const groups = new Map<string, Item[]>();
for (const i of fresh) {
  if (!groups.has(i.group)) groups.set(i.group, []);
  if (groups.get(i.group)!.length < perGroup) groups.get(i.group)!.push(i);
}
const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
const kept = ordered.flatMap(([, items]) => items);

function render(limit: number) {
  const indent = (s: string) => s.split("\n").map((l) => `  ${l}`).join("\n");
  const cut = (s: string) => (s.length > limit ? `${s.slice(0, limit)}…` : s);
  const parts = [
    `# What small business owners posted (fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)\n\n${kept.length} new posts, newest first in each group.`,
  ];
  for (const [group, items] of ordered) {
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
console.log(
  `pains.md: ${kept.length} new items in ${groups.size} groups (${found.length - fresh.length} seen before or repeated, ${fresh.length - kept.length} over the per-group cap), ${out.length} chars, bodies cut at ${limit}`,
);
