// Pulls the Hacker News front page plus every story over a points threshold from the last N hours
// via the Algolia HN API (no key) into hn.md in the current directory.
// Config from $TASK_DIR/task.json under "hn": hours (default 24), minPoints (default 80).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Hit = {
  objectID: string;
  title: string;
  url?: string | null;
  points: number;
  num_comments: number;
  created_at_i: number;
};

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const hours: number = config.hn?.hours ?? 24;
const minPoints: number = config.hn?.minPoints ?? 80;
const since = Math.floor(Date.now() / 1000 - hours * 3600);

async function search(params: Record<string, string>): Promise<Hit[]> {
  const url = `https://hn.algolia.com/api/v1/search?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return ((await res.json()) as { hits: Hit[] }).hits;
}

const [front, top] = await Promise.all([
  search({ tags: "front_page", hitsPerPage: "30" }),
  search({ tags: "story", numericFilters: `points>${minPoints},created_at_i>${since}`, hitsPerPage: "100" }),
]);

const byId = new Map<string, Hit>();
for (const h of [...front, ...top]) byId.set(h.objectID, h);
const stories = [...byId.values()].sort((a, b) => b.points - a.points);

const lines = stories.map((h) => {
  const when = new Date(h.created_at_i * 1000).toISOString().slice(0, 16).replace("T", " ");
  const hn = `https://news.ycombinator.com/item?id=${h.objectID}`;
  return `- ${when} · ${h.points} points · ${h.num_comments} comments\n  ${h.title}\n  ${h.url || hn}\n  discussion: ${hn}`;
});

const header = `# Hacker News (front page + stories over ${minPoints} points in the last ${hours}h, fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)\n\n${stories.length} stories, sorted by points.`;
await writeFile("hn.md", [header, ...lines].join("\n\n") + "\n");
console.log(`hn.md: ${stories.length} stories`);
