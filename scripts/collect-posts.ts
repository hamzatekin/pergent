// Collects what small business owners post, and what they pay others to do by hand, for the ideas
// radar: every post not seen before goes to posts.json in the current directory with the kind Jev
// gives it, and the runner saves the file to the database's posts table, which keeps them all.
// Keyless sources, under $TASK_DIR/task.json's "collect":
//   reddit       `subs`, read through Arctic Shift (arctic-shift.photon-reddit.com), a free archive of
//                Reddit that needs no key: every post of each subreddit since `hours` ago, 100 to a
//                page, removed and deleted posts left out. Reddit's own RSS ends on 2026-11-13 and its
//                logged-out JSON answers 403. Arctic Shift lags Reddit by an hour or two, which the
//                window covers, and refuses requests that come too fast (see arctic()).
//   freelancer   Freelancer.com's open projects API: `queries`, kept to `currencies` (USD and GBP, for UK
//                and US clients), `perQuery` newest each; a job paying someone to do a chore by hand is
//                the plainest sign the chore is worth money
//   khoros       Khoros communities with the public LiQL API, `{ host, name, skipBoards }` (Square's
//                seller community): their newest 100 topics, grouped by board, from `forumDays` back
// `hours` (default 24) is the window for Reddit and Freelancer. A post already in the posts table (read
// from ../../pergent.db, opened read-only) is skipped before Jev sees it, so the windows can overlap
// from run to run. No new fetch starts after `budgetSeconds` (default 210), which leaves Jev a minute and a
// half of the before command's 5.
// Kind: one Jev Choice question per post over `filter.kinds` (src/jev.ts); a post whose kind is in
// `filter.drop` with probability at least `filter.threshold` is stored with kept false and no body.
// Without TYPESAFE_API_KEY every post is kept with no kind.
// Back-fill: while the posts table is empty, the posts of every earlier run of the `backfill` task
// (pains) are read from its pains.md files, which hold what its Jev filter kept; they get no kind.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classify } from "../src/jev.ts";

type Post = {
  id: string;
  source: string;
  community: string;
  author: string;
  postedAt: string;
  title: string;
  body: string;
  url: string;
  budget?: string;
  kind?: string | null;
  kindP?: number | null;
  kept: boolean;
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const collect = config.collect ?? {};
const hours: number = collect.hours ?? 24;
const forumDays: number = collect.forumDays ?? 14;
const deadline = Date.now() + (collect.budgetSeconds ?? 210) * 1000;
const since = Date.now() - hours * 3_600_000;
const forumSince = Date.now() - forumDays * 86_400_000;
const BODY = 4000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: string[] = [];
const say = (line: string) => {
  log.push(line);
  console.log(line);
};

// A Reddit post is known by its id, whatever the slug or host in its link; anything else by its URL.
const postId = (url: string) => {
  const m = url.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i);
  return m ? `reddit:${m[1].toLowerCase()}` : url;
};

// What the database already holds. A fresh deployment has no file yet.
const seen = new Set<string>();
try {
  const db = new DatabaseSync(join("..", "..", "pergent.db"), { readOnly: true });
  for (const { id } of db.prepare("SELECT id FROM posts").all() as { id: string }[]) seen.add(id);
  db.close();
} catch (err) {
  say(`no posts read from the database: ${err instanceof Error ? err.message : err}`);
}
const empty = seen.size === 0;

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

// One retry on 429, after the wait the server asks for (or 10s), and only when there is time for it.
async function get(url: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 1) {
      const wait = Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset") ?? 10) * 1000;
      if (Date.now() + wait + 20_000 < deadline) {
        await sleep(wait);
        continue;
      }
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  }
}

type ArcticPost = {
  id: string;
  created_utc: number;
  title: string;
  author: string;
  permalink: string;
  selftext?: string;
  removed_by_category?: string | null;
  subreddit: string;
};

// Arctic Shift answers 422 "Timeout. Maybe slow down a bit" (and now and then 429) when asked too
// quickly, so its requests go one at a time, 2s apart, and a refused one is tried three more times,
// 5, 10 and 20s later. A subreddit that still fails is caught up by the next run, whose window
// overlaps this one.
async function arctic(params: URLSearchParams): Promise<ArcticPost[]> {
  for (let attempt = 0; ; attempt++) {
    await sleep(2000);
    const res = await fetch(`https://arctic-shift.photon-reddit.com/api/posts/search?${params}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    const wait = 5000 * 2 ** attempt;
    if ((res.status === 422 || res.status === 429) && attempt < 3 && Date.now() + wait + 30_000 < deadline) {
      await sleep(wait);
      continue;
    }
    const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok || data.error) throw new Error(`${res.status} ${data.error ?? res.statusText}`);
    return data.data ?? [];
  }
}

// Oldest first, a page at a time from the newest post of the page before.
async function reddit(sub: string): Promise<Post[]> {
  const posts: Post[] = [];
  let after = Math.floor(since / 1000);
  for (let page = 0; page < 10 && Date.now() < deadline; page++) {
    const items = await arctic(new URLSearchParams({ subreddit: sub, after: String(after), sort: "asc", limit: "100" }));
    for (const p of items) {
      const body = (p.selftext ?? "").trim();
      if (p.removed_by_category || p.author === "[deleted]" || body === "[removed]" || body === "[deleted]") continue;
      posts.push({
        id: `reddit:${p.id.toLowerCase()}`,
        source: "reddit",
        community: `r/${p.subreddit}`,
        author: p.author,
        postedAt: new Date(p.created_utc * 1000).toISOString(),
        title: decode(p.title),
        body: decode(body),
        url: `https://www.reddit.com${p.permalink}`,
      });
    }
    if (items.length < 100) break;
    after = items.at(-1)!.created_utc;
  }
  return posts;
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

async function freelancer(query: string): Promise<Post[]> {
  const currencies: string[] = collect.freelancer?.currencies ?? ["USD", "GBP"];
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
    .slice(0, collect.freelancer?.perQuery ?? 10)
    .map((p) => ({
      id: `https://www.freelancer.com/projects/${p.seo_url}`,
      source: "freelancer",
      community: `Freelancer "${query}"`,
      author: "",
      postedAt: new Date(p.time_submitted * 1000).toISOString(),
      title: p.title,
      body: (p.description ?? p.preview_description ?? "").trim(),
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      budget: `${p.budget.minimum ?? "?"} to ${p.budget.maximum ?? "?"} ${p.currency.code}${p.type === "hourly" ? " an hour" : ""}`,
    }));
}

type KhorosMessage = { id: string; subject: string; body: string; post_time: string; view_href: string; board: { id: string }; author?: { login?: string } };

async function khoros(host: string, name: string, skipBoards: string[] = []): Promise<Post[]> {
  const q = "SELECT id, subject, body, post_time, view_href, board.id, author.login FROM messages WHERE depth = 0 ORDER BY post_time DESC LIMIT 100";
  const data = JSON.parse(await get(`https://${host}/api/2.0/search?${new URLSearchParams({ q })}`));
  const messages: KhorosMessage[] = data.data?.items ?? [];
  return messages
    .filter((m) => !skipBoards.includes(m.board.id) && Date.parse(m.post_time) >= forumSince)
    .map((m) => ({
      id: m.view_href,
      source: "khoros",
      community: `${name}: ${m.board.id.replace(/-/g, " ")}`,
      author: m.author?.login ?? "",
      postedAt: new Date(m.post_time).toISOString(),
      title: decode(m.subject),
      body: text(m.body ?? ""),
      url: m.view_href,
    }));
}

// The posts an earlier pains run kept, from its pains.md: `## ` groups, then items of a "- date · author"
// line, the title, the body and the URL, each indented by two spaces.
async function backfill(task: string): Promise<Post[]> {
  const root = join("..", "..", task);
  const posts: Post[] = [];
  for (const run of (await readdir(root).catch(() => [] as string[])).sort()) {
    const md = await readFile(join(root, run, "pains.md"), "utf8").catch(() => "");
    let group = "";
    for (const block of md.split(/\n(?=## |- )/)) {
      if (block.startsWith("## ")) {
        group = block.slice(3).trim();
        continue;
      }
      if (!block.startsWith("- ") || !group) continue;
      const [head, ...rest] = block.trimEnd().split("\n");
      const lines = rest.map((l) => l.replace(/^ {2}/, ""));
      const url = lines.pop()?.trim() ?? "";
      if (!/^https?:\/\//.test(url)) continue;
      const [date, by = ""] = head.slice(2).split(" · ");
      const freelance = group.match(/^Freelancer\.com job posts for (".*")$/);
      const reddit = group.match(/^Reddit (r\/\S+)$/);
      posts.push({
        id: postId(url),
        source: reddit ? "reddit" : freelance ? "freelancer" : /^Square/.test(group) ? "khoros" : group.split(/[\s:]/)[0].toLowerCase(),
        community: reddit ? reddit[1] : freelance ? `Freelancer ${freelance[1]}` : group,
        author: freelance ? "" : by.trim(),
        postedAt: new Date(`${date.trim()}T12:00:00Z`).toISOString(),
        title: lines.shift()?.trim() ?? "",
        body: lines.join("\n").trim(),
        url,
        budget: freelance ? by.replace(/^budget /, "").trim() : undefined,
        kind: null,
        kindP: null,
        kept: true,
      });
    }
  }
  return posts;
}

const found: Post[] = [];
// Each result is printed as it comes, so before.log shows how far a run got even when it is stopped.
async function fetchFrom(label: string, run: () => Promise<Post[]>) {
  if (Date.now() > deadline) return say(`${label}: skipped, out of time`);
  try {
    const posts = await run();
    found.push(...posts);
    say(`${label}: ${posts.length}`);
  } catch (err) {
    say(`${label}: failed, ${err instanceof Error ? err.message : err}`);
  }
}

// Arctic Shift one subreddit at a time; the rest 6 at a time beside it.
const jobs: [string, () => Promise<Post[]>][] = [
  ...(collect.freelancer?.queries ?? []).map((q: string) => [`freelancer "${q}"`, () => freelancer(q)]),
  ...(collect.khoros ?? []).map((k: { host: string; name: string; skipBoards?: string[] }) => [k.name, () => khoros(k.host, k.name, k.skipBoards)]),
];
await Promise.all([
  (async () => {
    for (const sub of (collect.reddit?.subs ?? []) as string[]) await fetchFrom(`r/${sub}`, () => reddit(sub));
  })(),
  ...Array.from({ length: 6 }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await fetchFrom(...job);
  }),
]);

// New posts only, each once (a job can come from two queries), with something to read.
const fresh: Post[] = [];
for (const p of found) {
  if (seen.has(p.id) || !(p.title || p.body)) continue;
  seen.add(p.id);
  p.body = p.body.length > BODY ? `${p.body.slice(0, BODY)}…` : p.body;
  fresh.push(p);
}

// What Jev reads: the item as the pains task's model used to see it, the body cut shorter.
const apiKey = process.env.TYPESAFE_API_KEY;
const filter = config.filter ?? {};
const drop = new Set<string>(filter.drop ?? []);
const threshold: number = filter.threshold ?? 0.6;
if (apiKey && fresh.length) {
  const texts = fresh.map((p) => {
    const by = p.budget ? ` · budget ${p.budget}` : p.author ? ` · ${p.author}` : "";
    const body = p.body.length > 1500 ? `${p.body.slice(0, 1500)}…` : p.body;
    return `- ${p.community} · ${p.postedAt.slice(0, 10)}${by}\n  ${p.title}${body ? `\n  ${body.replace(/\n/g, "\n  ")}` : ""}`;
  });
  const { answers, requests, failures } = await classify(texts, filter.kinds ?? {}, filter.about ?? "post", apiKey);
  fresh.forEach((p, i) => {
    const a = answers[i];
    p.kind = a?.choice ?? null;
    p.kindP = a ? Math.round((a.probabilities?.[a.choice] ?? 0) * 100) / 100 : null;
    p.kept = !(a && drop.has(a.choice) && (p.kindP ?? 0) >= threshold);
  });
  const kinds = Object.keys(filter.kinds ?? {}).map((k) => `${fresh.filter((p) => p.kind === k).length} ${k}`).join(", ");
  say(`jev-latest: ${fresh.length} posts in ${requests} requests: ${kinds}; ${fresh.filter((p) => !p.kept).length} dropped at p >= ${threshold}, ${failures.length} requests failed`);
  for (const f of failures) say(`failed: ${f}`);
} else {
  for (const p of fresh) p.kept = true;
  if (!apiKey) say("no TYPESAFE_API_KEY: every post kept, without a kind");
}

let backfilled: Post[] = [];
if (empty && collect.backfill) {
  backfilled = (await backfill(collect.backfill)).filter((p) => !seen.has(p.id) && (seen.add(p.id), true));
  say(`back-fill from ${collect.backfill}: ${backfilled.length} posts`);
}

const all = [...fresh, ...backfilled];
await writeFile("posts.json", JSON.stringify(all));
await writeFile("collect.log", log.join("\n") + "\n");
const bySource = [...new Set(all.map((p) => p.source))].map((s) => `${all.filter((p) => p.source === s && p.kept).length} ${s}`).join(", ");
console.log(`posts.json: ${all.length} new posts (${found.length - fresh.length} seen before or repeated), ${all.filter((p) => p.kept).length} kept: ${bySource}`);
