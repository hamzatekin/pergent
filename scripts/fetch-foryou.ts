// The For You feed's input: every account `foryou.account` follows, their posts from the last
// `foryou.hours`, ranked in code, and the top `foryou.top` written to foryou.md for the model to lay out.
// All through FxTwitter, no API key: `/2/profile/{handle}/following` for the list (50 a page), then
// `/2/profile/{handle}/statuses` (page one only, about 20 posts) per account.
//
// Ranking, all from numbers FxTwitter already returns:
//   engagement  likes + 2 × bookmarks + 2 × reposts (a bookmark or a repost says more than a like)
//   lift        ln((engagement + 1) / (author's median + 1)), the median over the author's own posts on
//               page one, older ones included, so a post is measured against what that account usually
//               gets and big accounts do not win by size alone
//   reach       0.25 × ln(engagement + 1), so a post everyone is talking about still ranks
//   followed    0.7 × ln(number of followed accounts that posted or reposted it): a post several of
//               your accounts repost is one you would want to see, even from an account you do not follow
// Replies to other people are dropped, self-replies (threads) kept; at most `foryou.perAuthor` posts per
// author make the cut.
//
// Config, from $TASK_DIR/task.json under "foryou":
//   account     the X handle whose following list is the feed
//   hours       lookback window (default 24)
//   top         posts written to foryou.md (default 150)
//   perAuthor   most posts per author in the top (default 3)
//   maxChars    size cap for foryou.md (default 80000), the lowest ranked posts go first
// The live list is written to following.json in the run directory. When the list cannot be fetched, the
// task's committed following.json is used instead, so a FxTwitter hiccup does not empty the feed.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type User = { screen_name: string; name: string };
type Status = {
  url: string;
  text: string;
  created_timestamp: number;
  likes: number;
  reposts?: number;
  bookmarks?: number;
  views?: number;
  replies: number;
  author: User;
  replying_to?: { screen_name: string } | null;
  quote?: { text?: string; url?: string; author?: User } | null;
  media?: { photos?: { url: string }[]; videos?: { thumbnail_url?: string }[] } | null;
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8")).foryou ?? {};
const account: string = config.account;
const hours: number = config.hours ?? 24;
const top: number = config.top ?? 150;
const perAuthor: number = config.perAuthor ?? 3;
const maxChars: number = config.maxChars ?? 80_000;
const since = Date.now() / 1000 - hours * 3600;
if (!account) throw new Error('task.json has no "foryou.account"');

// FxTwitter answers 404, not 429, when it pushes back; see fetch-x.ts. Three tries, 3s then 6s apart.
async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (res?.ok) return (await res.json()) as T;
    if (attempt === 2) throw new Error(res ? `${res.status} ${res.statusText}` : "fetch failed");
    await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
  }
}

async function fetchFollowing(): Promise<User[]> {
  const out: User[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const body = await getJson<{ results?: User[]; cursor?: { bottom?: string } }>(
      `https://api.fxtwitter.com/2/profile/${account}/following${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const results = body.results ?? [];
    out.push(...results.map((u) => ({ screen_name: u.screen_name, name: u.name })));
    if (!results.length || !body.cursor?.bottom || body.cursor.bottom === cursor) break;
    cursor = body.cursor.bottom;
  }
  return out;
}

let following: User[];
try {
  following = await fetchFollowing();
  if (!following.length) throw new Error("empty list");
  console.log(`following: ${following.length} accounts from @${account}`);
} catch (err) {
  following = JSON.parse(await readFile(join(process.env.TASK_DIR!, "following.json"), "utf8"));
  console.log(`following list failed (${err instanceof Error ? err.message : String(err)}), using the committed ${following.length}`);
}
await writeFile("following.json", JSON.stringify(following));

// Every post seen, keyed by URL, with who among the followed accounts posted or reposted it.
type Candidate = { status: Status; by: Set<string>; baseline?: number };
const candidates = new Map<string, Candidate>();
const baselines = new Map<string, number>();
const failed: string[] = [];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const engagement = (s: Status) => s.likes + 2 * (s.bookmarks ?? 0) + 2 * (s.reposts ?? 0);

async function fetchAccount(handle: string) {
  const body = await getJson<{ results?: Status[] }>(`https://api.fxtwitter.com/2/profile/${handle}/statuses`);
  const key = handle.toLowerCase();
  const results = body.results ?? [];
  const own = results.filter((s) => s.author.screen_name.toLowerCase() === key);
  if (own.length >= 3) baselines.set(key, median(own.map(engagement)));
  for (const s of results) {
    if (s.created_timestamp < since) continue;
    const author = s.author.screen_name.toLowerCase();
    if (s.replying_to && s.replying_to.screen_name.toLowerCase() !== author) continue;
    const c = candidates.get(s.url) ?? { status: s, by: new Set<string>() };
    c.by.add(handle);
    candidates.set(s.url, c);
  }
}

// A worker pool, as in fetch-x.ts; more workers since the list is ten times longer.
const handles = following.map((u) => u.screen_name);
let next = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: 10 }, async () => {
    while (next < handles.length) {
      const handle = handles[next++];
      try {
        await fetchAccount(handle);
      } catch (err) {
        failed.push(`${handle}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }),
);
console.log(`${handles.length} accounts fetched in ${Math.round((Date.now() - started) / 1000)}s, ${failed.length} failed, ${candidates.size} posts`);

// A followed author with too few posts for a median of their own gets the typical one. An author the
// reader does not follow (here because someone reposted them) gets no lift at all: measured against
// any guess, strangers' viral posts filled the top, so they rank on reach and on how many followed
// accounts reposted them.
const typical = median([...baselines.values()]);
const followed = new Set(handles.map((h) => h.toLowerCase()));
const MAX_LIFT = Math.log(30);
const ranked = [...candidates.values()]
  .map((c) => {
    const s = c.status;
    const author = s.author.screen_name.toLowerCase();
    const e = engagement(s);
    const base = followed.has(author) ? (baselines.get(author) ?? typical) : undefined;
    const lift = base === undefined ? 0 : Math.min(Math.log((e + 1) / (base + 1)), MAX_LIFT);
    const score = lift + 0.3 * Math.log(e + 1) + Math.log(c.by.size);
    return { ...c, base, score };
  })
  .sort((a, b) => b.score - a.score);

// Every scored post, slim, so the ranking can be tuned from a run directory without fetching again.
await writeFile(
  "posts.json",
  JSON.stringify(ranked.map((c) => ({ url: c.status.url, author: c.status.author.screen_name, likes: c.status.likes, bookmarks: c.status.bookmarks ?? 0, reposts: c.status.reposts ?? 0, replies: c.status.replies, by: [...c.by], base: c.base, score: +c.score.toFixed(3) }))),
);

const perAuthorCount = new Map<string, number>();
const picked = ranked.filter((c) => {
  const a = c.status.author.screen_name.toLowerCase();
  const n = perAuthorCount.get(a) ?? 0;
  if (n >= perAuthor) return false;
  perAuthorCount.set(a, n + 1);
  return true;
}).slice(0, top);

const images: Record<string, string> = {};
const clip = (t: string, n: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const entries = picked.map((c, i) => {
  const s = c.status;
  const image = s.media?.photos?.[0]?.url ?? s.media?.videos?.[0]?.thumbnail_url;
  if (image) images[s.url] = image;
  const when = new Date(s.created_timestamp * 1000).toISOString().slice(0, 16).replace("T", " ");
  const reposters = [...c.by].filter((h) => h.toLowerCase() !== s.author.screen_name.toLowerCase());
  const lines = [
    `### ${i + 1}. @${s.author.screen_name} (${s.author.name}) · score ${c.score.toFixed(2)}`,
    `${when} UTC · ${s.likes} likes · ${s.bookmarks ?? 0} bookmarks · ${s.reposts ?? 0} reposts · ${s.replies} replies · ${c.base === undefined ? "not followed" : `usually ~${Math.round(c.base)}`}${reposters.length ? ` · reposted by ${reposters.map((h) => `@${h}`).join(", ")}` : ""}${image ? " · has image" : ""}`,
    "",
    clip(s.text, 800),
  ];
  if (s.quote?.text) lines.push("", `> Quoting${s.quote.author ? ` @${s.quote.author.screen_name}` : ""}: ${clip(s.quote.text, 400)}`);
  lines.push("", s.url);
  return lines.join("\n");
});

let kept = entries;
while (kept.length && kept.reduce((n, e) => n + e.length + 2, 0) > maxChars) kept = kept.slice(0, -1);
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
await writeFile(
  "foryou.md",
  `# For You: the top ${kept.length} of ${candidates.size} posts from the ${handles.length} accounts @${account} follows (last ${hours}h, fetched ${stamp} UTC)\n\nRanked best first.\n\n${kept.join("\n\n")}\n`,
);
console.log(`foryou.md: ${kept.length} posts${kept.length < entries.length ? ` (${entries.length - kept.length} dropped for size)` : ""}`);
for (const f of failed) console.log(`  failed ${f}`);

const merged: Record<string, string> = JSON.parse(await readFile("images.json", "utf8").catch(() => "{}"));
await writeFile("images.json", JSON.stringify({ ...images, ...merged }));
console.log(`images.json: ${Object.keys(images).length} post images`);
