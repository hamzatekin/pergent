// Pulls recent posts for a set of X handles via FxTwitter (no API key) into tweets.md (accounts from
// remote lists) and tweets-web.md (hand-picked handles), and what tech Twitter is discussing via
// techtwitter.com's public API into discourse.md. All land in the current directory.
// Config comes from $TASK_DIR/task.json under "x":
//   hours       lookback window (default 24)
//   lists       [{ url, categories? }] JSON exports in the awesome-ai-x-accounts format
//               ({ categories: [{id,title}], accounts: [{handle,category}] }); categories filters by id
//   handles     { "group name": ["handle", ...] } hand-picked accounts, or a plain array
//   techtwitter set false to skip discourse.md
//   maxChars    per-file size cap (default 60000). claude's Read returns at most ~25k tokens, so each file
//               is trimmed under the cap by dropping the least-liked posts first; post text is cut at 600 chars.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Status = {
  id: string;
  url: string;
  text: string;
  created_timestamp: number;
  likes: number;
  views: number;
  replies: number;
  author: { screen_name: string; name: string };
  replying_to?: { screen_name: string } | null;
};

type ListExport = {
  categories?: { id: string; title?: string }[];
  accounts: { handle: string; category?: string }[];
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const hours: number = config.x?.hours ?? 24;
const maxChars: number = config.x?.maxChars ?? 60_000;
const since = Date.now() / 1000 - hours * 3600;

// Build group -> handles, first from remote lists, then hand-picked handles. First mention wins.
const groups = new Map<string, string[]>();
const seen = new Set<string>();
function add(group: string, handle: string) {
  const key = handle.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  groups.set(group, [...(groups.get(group) ?? []), handle]);
}

for (const list of (config.x?.lists ?? []) as { url: string; categories?: string[] }[]) {
  try {
    const res = await fetch(list.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as ListExport;
    const titles = new Map((body.categories ?? []).map((c) => [c.id, c.title ?? c.id]));
    // Seed groups in config order so the output follows list.categories, not the export's account order.
    for (const id of list.categories ?? []) if (!groups.has(titles.get(id) ?? id)) groups.set(titles.get(id) ?? id, []);
    let n = 0;
    for (const a of body.accounts) {
      const cat = a.category ?? "other";
      if (list.categories && !list.categories.includes(cat)) continue;
      add(titles.get(cat) ?? cat, a.handle);
      n++;
    }
    console.log(`list ${list.url}: ${n} accounts`);
  } catch (err) {
    console.log(`list ${list.url} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const picked = config.x?.handles ?? {};
const pickedGroups = new Set<string>();
for (const [group, handles] of Array.isArray(picked) ? [["Hand-picked", picked]] : Object.entries(picked)) {
  pickedGroups.add(group as string);
  for (const h of handles as string[]) add(group as string, h);
}

async function fetchRecent(handle: string): Promise<Status[]> {
  const out: Status[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const url = `https://api.fxtwitter.com/2/profile/${handle}/statuses${cursor ? `?cursor=${cursor}` : ""}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = (await res.json()) as { results: Status[]; cursor?: { bottom?: string } };
    const results = body.results ?? [];
    out.push(...results.filter((s) => s.created_timestamp >= since));
    const oldest = results.at(-1);
    cursor = body.cursor?.bottom;
    if (!oldest || oldest.created_timestamp < since || !cursor) break;
  }
  return out;
}

type Post = { group: string; handle: string; likes: number; text: string };

function toPosts(group: string, handle: string, statuses: Status[]): Post[] {
  // Drop replies to other people; keep self-replies (threads).
  const kept = statuses.filter((s) => !s.replying_to || s.replying_to.screen_name.toLowerCase() === handle.toLowerCase());
  return kept
    .sort((a, b) => b.created_timestamp - a.created_timestamp)
    .map((s) => {
      const when = new Date(s.created_timestamp * 1000).toISOString().slice(0, 16).replace("T", " ");
      const rt = s.author.screen_name.toLowerCase() !== handle.toLowerCase() ? ` (repost of @${s.author.screen_name})` : "";
      let text = s.text.replace(/\s+/g, " ").trim();
      if (text.length > 600) text = text.slice(0, 600) + "…";
      return { group, handle, likes: s.likes, text: `- ${when}${rt} · ${s.likes} likes · ${s.replies} replies\n  ${text}\n  ${s.url}` };
    });
}

// Fetch all handles with a small worker pool so ~130 accounts finish in well under a minute.
const all = [...groups.entries()].flatMap(([group, hs]) => hs.map((h) => ({ group, handle: h })));
const posts: Post[] = [];
const failed: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < all.length) {
      const { group, handle } = all[next++];
      try {
        posts.push(...toPosts(group, handle, await fetchRecent(handle)));
      } catch (err) {
        failed.push(`${handle}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }),
);

// Group posts by category then handle, trimming the least-liked posts until the file fits the cap.
function renderFile(title: string, input: Post[]): { body: string; kept: number; dropped: number; accounts: number } {
  let kept = [...input];
  let dropped = 0;
  const size = () => kept.reduce((n, p) => n + p.text.length + 2, 0);
  const byLikes = [...input].sort((a, b) => a.likes - b.likes);
  while (size() > maxChars && byLikes.length) {
    const victim = byLikes.shift()!;
    kept = kept.filter((p) => p !== victim);
    dropped++;
  }
  const sections: string[] = [];
  for (const [group, hs] of groups) {
    const parts: string[] = [];
    for (const h of hs) {
      const mine = kept.filter((p) => p.handle === h);
      if (mine.length) parts.push(`### @${h}\n\n${mine.map((p) => p.text).join("\n\n")}`);
    }
    if (parts.length) sections.push(`## ${group}\n\n${parts.join("\n\n")}`);
  }
  const accounts = new Set(kept.map((p) => p.handle)).size;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const header = `# ${title} (last ${hours}h, fetched ${stamp} UTC)\n\n${kept.length} posts from ${accounts} accounts, grouped by category.${dropped ? ` ${dropped} low-engagement posts omitted to fit the size cap.` : ""}`;
  return { body: [header, ...sections].join("\n\n") + "\n", kept: kept.length, dropped, accounts };
}

// techtwitter.com: curated tech tweets ranked by discussion. 403s without a browser user agent.
type TTTweet = {
  tweet_url: string;
  tweet_text: string;
  summary?: string;
  author_handle: string;
  timestamp: string;
  comment_count: number;
  like_count: number;
};

async function fetchTechTwitter(): Promise<string> {
  const feeds: [string, string][] = [
    ["Most discussed (ranked by replies)", "command/hot-takes?limit=50"],
    ["Trending", "tweets/trending?limit=50"],
    ["AI/ML stream", "command/streams?category=ai-ml&limit=50"],
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const [title, path] of feeds) {
    const res = await fetch(`https://www.techtwitter.com/api/${path}`, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      parts.push(`## ${title}\n\n(failed: ${res.status})`);
      continue;
    }
    const tweets = ((await res.json()) as { tweets?: TTTweet[] }).tweets ?? [];
    const fresh = tweets.filter((t) => !seen.has(t.tweet_url) && new Date(t.timestamp).getTime() / 1000 >= since);
    for (const t of fresh) seen.add(t.tweet_url);
    const lines = fresh.map((t) => {
      const when = t.timestamp.slice(0, 16).replace("T", " ");
      let text = t.tweet_text.replace(/\s+/g, " ").trim();
      if (text.length > 600) text = text.slice(0, 600) + "…";
      return `- ${when} @${t.author_handle} · ${t.like_count} likes · ${t.comment_count} replies\n  ${text}\n  ${t.tweet_url}`;
    });
    parts.push(`## ${title}\n\n${lines.join("\n\n") || "(nothing new)"}`);
  }
  return `# What tech Twitter is discussing (last ${hours}h, via techtwitter.com)\n\n${parts.join("\n\n")}\n`;
}

if (config.x?.techtwitter !== false) {
  try {
    const discourse = await fetchTechTwitter();
    await writeFile("discourse.md", discourse);
    console.log(`discourse.md: ${discourse.split("\n- ").length - 1} posts`);
  } catch (err) {
    console.log(`discourse fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const listPosts = posts.filter((p) => !pickedGroups.has(p.group));
const webPosts = posts.filter((p) => pickedGroups.has(p.group));
const a = renderFile("Posts from AI accounts", listPosts);
const b = renderFile("Posts from hand-picked accounts", webPosts);
await writeFile("tweets.md", a.body);
await writeFile("tweets-web.md", b.body);
console.log(`tweets.md: ${a.kept} posts from ${a.accounts} accounts (${a.dropped} dropped for size); tweets-web.md: ${b.kept} posts from ${b.accounts} accounts (${b.dropped} dropped); ${all.length} accounts fetched, ${failed.length} failed`);
for (const f of failed) console.log(`  failed ${f}`);
