// Pulls recent posts for a set of X handles via FxTwitter (no API key) into tweets.md (accounts from
// remote lists) and tweets-web.md (hand-picked handles), and what tech Twitter is discussing via
// techtwitter.com's public API into discourse.md. All land in the current directory.
// Config comes from $TASK_DIR/task.json under "x":
//   hours       lookback window (default 24)
//   lists       [{ url | file, categories? }] JSON exports in the awesome-ai-x-accounts format
//               ({ categories: [{id,title}], accounts: [{handle,category}] }); categories filters by id.
//               `file` is relative to the task directory: the committed base list. A remote list can
//               vanish (it did), so it only ever adds accounts on top of the file.
//   handles     { "group name": ["handle", ...] } hand-picked accounts, or a plain array
//   techtwitter set false to skip discourse.md
//   maxChars    per-file size cap (default 60000). claude's Read returns at most ~25k tokens, so each file
//               is trimmed under the cap by dropping the least-liked posts first; post text is cut at 600 chars.
//   trim        "busiest" drops the least-liked post of the account with the most posts in the file instead,
//               so a handful of high-volume, high-like accounts cannot crowd everyone else out
//   out         base name of the hand-picked file (default "tweets-web")
//   files       number of hand-picked files (default 1): with more, handles are dealt round-robin over
//               <out>-1.md … <out>-N.md, each under maxChars
//   images      true writes the first photo (or video thumbnail) of each post to images.json, post URL to
//               image, merged with what is there, for the reading view
// The merged list goes to accounts.json in the run directory, so a lost source can be recovered from
// any run.
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
  media?: { photos?: { url: string }[]; videos?: { thumbnail_url?: string }[] } | null;
};

type ListExport = {
  categories?: { id: string; title?: string }[];
  accounts: { handle: string; category?: string }[];
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const hours: number = config.x?.hours ?? 24;
const maxChars: number = config.x?.maxChars ?? 60_000;
const trimBusiest = config.x?.trim === "busiest";
const out: string = config.x?.out ?? "tweets-web";
const files: number = config.x?.files ?? 1;
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

for (const list of (config.x?.lists ?? []) as { url?: string; file?: string; categories?: string[] }[]) {
  const source = list.file ? join(process.env.TASK_DIR!, list.file) : list.url!;
  try {
    let body: ListExport;
    if (list.file) body = JSON.parse(await readFile(source, "utf8"));
    else {
      const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      body = (await res.json()) as ListExport;
    }
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
    console.log(`list ${source}: ${n} accounts`);
  } catch (err) {
    console.log(`list ${source} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const picked = config.x?.handles ?? {};
const pickedGroups = new Set<string>();
for (const [group, handles] of Array.isArray(picked) ? [["Hand-picked", picked]] : Object.entries(picked)) {
  pickedGroups.add(group as string);
  for (const h of handles as string[]) add(group as string, h);
}

// Everything that was fetched this run, in the list export format, so the base list can be rebuilt
// from any run directory if a source disappears.
await writeFile(
  "accounts.json",
  JSON.stringify({
    categories: [...groups.keys()].map((title) => ({ id: title, title })),
    accounts: [...groups.entries()].flatMap(([title, hs]) => hs.map((handle) => ({ handle, category: title }))),
  }),
);

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
const images: Record<string, string> = {};

function toPosts(group: string, handle: string, statuses: Status[]): Post[] {
  // Drop replies to other people; keep self-replies (threads).
  const kept = statuses.filter((s) => !s.replying_to || s.replying_to.screen_name.toLowerCase() === handle.toLowerCase());
  return kept
    .sort((a, b) => b.created_timestamp - a.created_timestamp)
    .map((s) => {
      const image = s.media?.photos?.[0]?.url ?? s.media?.videos?.[0]?.thumbnail_url;
      if (image) images[s.url] = image;
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
  while (size() > maxChars && kept.length) {
    let victim = byLikes[0];
    if (trimBusiest) {
      const counts = new Map<string, number>();
      for (const p of kept) counts.set(p.handle, (counts.get(p.handle) ?? 0) + 1);
      const busiest = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      victim = byLikes.find((p) => p.handle === busiest)!;
    }
    byLikes.splice(byLikes.indexOf(victim), 1);
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

if (config.x?.lists?.length) {
  const a = renderFile("Posts from AI accounts", posts.filter((p) => !pickedGroups.has(p.group)));
  await writeFile("tweets.md", a.body);
  console.log(`tweets.md: ${a.kept} posts from ${a.accounts} accounts (${a.dropped} dropped for size)`);
}

// Hand-picked handles in config order, dealt round-robin so every file mixes the groups.
const picks = all.filter((x) => pickedGroups.has(x.group)).map((x) => x.handle);
for (let i = 0; i < files; i++) {
  const mine = new Set(picks.filter((_, j) => j % files === i));
  const name = files > 1 ? `${out}-${i + 1}.md` : `${out}.md`;
  const b = renderFile(files > 1 ? `Posts from hand-picked accounts, part ${i + 1} of ${files}` : "Posts from hand-picked accounts", posts.filter((p) => mine.has(p.handle)));
  await writeFile(name, b.body);
  console.log(`${name}: ${b.kept} posts from ${b.accounts} accounts (${b.dropped} dropped for size)`);
}
console.log(`${all.length} accounts fetched, ${failed.length} failed`);
for (const f of failed) console.log(`  failed ${f}`);

if (config.x?.images) {
  const merged: Record<string, string> = JSON.parse(await readFile("images.json", "utf8").catch(() => "{}"));
  await writeFile("images.json", JSON.stringify({ ...images, ...merged }));
  console.log(`images.json: ${Object.keys(images).length} post images`);
}
