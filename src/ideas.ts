// The ideas radar's sort and its counts. Every 3 hours the ideas task collects posts
// (scripts/collect-posts.ts); then prepareSort writes the kept posts no sort has seen yet, and the
// problems so far, into the run directory, haiku says which problem each post raises (opening a new
// one when none fits) along with what the post says about it, and saveSortOutput stores that in the
// problems and mentions tables. The counting is code (board): people, sources, paid jobs, weeks, and a
// trend label. The model never counts.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listProblems, mentionFacts, saveSort, unsortedPosts, type Mention, type PostRow } from "./db.ts";
import { mentions } from "./mute.ts";
import type { TaskConfig } from "./runner.ts";

// Who has the problem. Fixed, so the page can filter by it and counts stay comparable; a task can set
// its own under "categories". The last one takes whatever fits nowhere else.
export const CATEGORIES = [
  "Landlords & property",
  "Ecommerce & marketplaces",
  "Bookkeeping & tax",
  "Trades & field services",
  "Restaurants & food",
  "Salons & health clinics",
  "Professional services",
  "Logistics & freight",
  "Events & creative",
  "General admin",
];

const categoriesOf = (config: TaskConfig) => (config.categories as string[] | undefined) ?? CATEGORIES;
const sortConfig = (config: TaskConfig) => (config.sort ?? {}) as { maxPosts?: number; bodyChars?: number };

export function sortSchema(config: TaskConfig) {
  const text = (description: string) => ({ type: "string", description });
  return {
    type: "object",
    required: ["problems", "posts"],
    additionalProperties: false,
    properties: {
      problems: {
        type: "array",
        description: "The new problems this batch opens, only those no existing problem covers. Empty when every post fits an existing one.",
        items: {
          type: "object",
          required: ["key", "name", "category", "summary"],
          additionalProperties: false,
          properties: {
            key: text("n1, n2, n3…: how `posts` refers to this new problem."),
            name: text("The problem in the words of the people who have it, at most 12 words, like \"Re-typing rent payments into MTD software every quarter\". Not a product name."),
            category: { type: "string", enum: categoriesOf(config), description: "Who has it." },
            summary: text("One sentence: who has it, what they do today, what it costs them."),
          },
        },
      },
      posts: {
        type: "array",
        description: "Every post of posts.md, once each, in any order.",
        items: {
          type: "object",
          required: ["ref", "problem", "recurring", "cost", "workaround", "quote"],
          additionalProperties: false,
          properties: {
            ref: text("The post's ref from posts.md, like p12."),
            problem: text("The number of the existing problem it raises (\"17\"), the key of a new one (\"n1\"), or \"\" when it raises none."),
            recurring: { type: "boolean", description: "The post says it happens again and again: every week, month, order, job or tenant; or it is a job post for a recurring chore." },
            cost: text("Money or time the post names for it, short, like \"$400 a month\" or \"6 hours a week\". Not a job post's budget, which is already known. \"\" when it names none."),
            workaround: text("What they do about it today, short, like \"a spreadsheet\", \"a VA\", \"copies between Square and Xero by hand\". \"\" when the post doesn't say."),
            quote: text("At most 20 words copied from the post that show the problem. \"\" when it raises none."),
          },
        },
      },
    },
  };
}

// Writes problems.md (the categories, then every problem by category with its number) and posts.md (the
// newest kept posts no sort has seen, up to `sort.maxPosts`, each under a ref) into the run directory,
// and sort.json, the refs and problem numbers saveSortOutput checks the answer against. Posts that
// mention a muted phrase are set aside here, without the model. Returns how many posts went in.
export async function prepareSort(task: string, runId: string, dir: string, config: TaskConfig, muted: string[]): Promise<{ posts: number; waiting: number }> {
  const { maxPosts = 250, bodyChars = 700 } = sortConfig(config);
  const { posts: fetched, total } = unsortedPosts(maxPosts);
  const isMuted = (p: PostRow) => muted.find((m) => mentions(`${p.community}\n${p.title}\n${p.body}\n${p.url}`, m));
  const set = fetched.filter(isMuted).map((p): Mention => ({ postId: p.id, problemId: null, recurring: false, cost: "", workaround: "", quote: "", note: `muted: ${isMuted(p)}` }));
  if (set.length) saveSort(runId, [], set);
  const posts = fetched.filter((p) => !isMuted(p));

  const problems = listProblems();
  const lines = ["# Categories", "", ...categoriesOf(config).map((c) => `- ${c}`), "", `# Problems so far (${problems.length})`];
  for (const c of categoriesOf(config)) {
    const these = problems.filter((p) => p.category === c);
    if (!these.length) continue;
    lines.push("", `## ${c}`, ...these.map((p) => `- ${p.id}: ${p.name}. ${p.summary}`));
  }
  if (!problems.length) lines.push("", "None yet: this is the first sort.");
  await writeFile(join(dir, "problems.md"), lines.join("\n") + "\n");

  const refs: Record<string, string> = {};
  const blocks = posts.map((p, i) => {
    const ref = `p${i + 1}`;
    refs[ref] = p.id;
    const body = p.body.length > bodyChars ? `${p.body.slice(0, bodyChars)}…` : p.body;
    const by = [p.community, p.postedAt.slice(0, 10), p.budget && `budget ${p.budget}`].filter(Boolean).join(" · ");
    return `### ${ref} · ${by}\n${p.title}${body ? `\n\n${body}` : ""}`;
  });
  await writeFile(join(dir, "posts.md"), `# Posts to sort (${posts.length})\n\n${blocks.join("\n\n")}\n`);
  await writeFile(join(dir, "sort.json"), JSON.stringify({ refs, problems: problems.map((p) => p.id) }));
  return { posts: posts.length, waiting: total - fetched.length };
}

type SortOutput = {
  problems: { key: string; name: string; category: string; summary: string }[];
  posts: { ref: string; problem: string; recurring: boolean; cost: string; workaround: string; quote: string }[];
};

// Stores the sort: new problems that at least one post went to, and a mention for every post of the
// batch. A post the answer left out, or sent to a problem that does not exist, is stored with a note and
// no problem, so it does not come back. Returns the run's summary in markdown, or null when the answer
// is not a sort at all (the run then fails and the posts wait for the next one).
export async function saveSortOutput(runId: string, output: unknown, dir: string, config: TaskConfig): Promise<string | null> {
  const out = output as SortOutput | undefined;
  if (!out || !Array.isArray(out.problems) || !Array.isArray(out.posts)) return null;
  const { refs, problems: known } = JSON.parse(await readFile(join(dir, "sort.json"), "utf8")) as { refs: Record<string, string>; problems: number[] };
  const existing = new Set(known);
  const categories = categoriesOf(config);
  const opened = out.problems.filter((p) => p?.key && p.name?.trim());
  const used = new Set(out.posts.map((p) => p?.problem));
  const kept = opened.filter((p) => used.has(p.key));
  const index = new Map(kept.map((p, i) => [p.key, -(i + 1)]));

  const found = new Map<string, Mention>();
  for (const p of out.posts) {
    const postId = refs[p?.ref];
    if (!postId || found.has(postId)) continue;
    const ref = String(p.problem ?? "").trim();
    const problemId = /^\d+$/.test(ref) && existing.has(Number(ref)) ? Number(ref) : (index.get(ref) ?? null);
    const note = problemId === null ? (ref ? `unknown problem ${ref}` : "not a problem") : undefined;
    const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
    found.set(postId, {
      postId,
      problemId,
      recurring: problemId !== null && p.recurring === true,
      cost: problemId === null ? "" : clip(p.cost, 120),
      workaround: problemId === null ? "" : clip(p.workaround, 160),
      quote: problemId === null ? "" : clip(p.quote, 300),
      note,
    });
  }
  const skipped = Object.values(refs).filter((id) => !found.has(id));
  for (const postId of skipped) found.set(postId, { postId, problemId: null, recurring: false, cost: "", workaround: "", quote: "", note: "left out of the answer" });

  const ids = saveSort(
    runId,
    kept.map((p) => ({ name: p.name.trim(), category: categories.includes(p.category) ? p.category : categories.at(-1)!, summary: String(p.summary ?? "").trim() })),
    [...found.values()],
  );
  const all = [...found.values()];
  const raising = all.filter((m) => m.problemId !== null);
  return [
    `# Sort, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${all.length} posts: ${raising.filter((m) => m.problemId! > 0).length} to existing problems, ${raising.filter((m) => m.problemId! < 0).length} to ${kept.length} new problems, ${all.length - raising.length - skipped.length} raise none, ${skipped.length} left out of the answer.`,
    ...(kept.length ? ["", "## New problems", "", ...kept.map((p, i) => `- ${ids[i]}: ${p.name} (${p.category})`)] : []),
  ].join("\n") + "\n";
}

export type Trend = "new" | "rising" | "steady" | "fading";
export type ProblemStats = {
  id: number;
  mentions: number;
  people: number;
  sources: string[];
  communities: string[];
  jobs: number;
  budgets: string[];
  recurring: number;
  costed: number;
  workarounds: number;
  first: string;
  last: string;
  /** Mentions per week, this week first, for the last 8 weeks. */
  weeks: number[];
  trend: Trend | null;
};

const WEEK = 7 * 86_400_000;

// The counts behind each problem, from every mention it has. A person is a source's author, or, when the
// source names none (Freelancer, back-filled forum posts), the post's title: Freelancer clients repost
// the same job as "Title -- 2", "Title -- 3". Weeks are counted back from
// now, so "this week" is the last 7 days. The trend:
//   new     first seen in the last 7 days, with 2 or more mentions
//   rising  3 or more mentions this week, at least double its weekly average over the 4 weeks before
//   steady  mentioned in at least 3 of the last 4 weeks
//   fading  nothing in the last two weeks, after 2 or more in the 4 weeks before this one
export function problemStats(now = Date.now()): Map<number, ProblemStats> {
  const stats = new Map<number, ProblemStats & { people_: Set<string> }>();
  for (const f of mentionFacts()) {
    let s = stats.get(f.problemId);
    if (!s) {
      s = { id: f.problemId, mentions: 0, people: 0, people_: new Set(), sources: [], communities: [], jobs: 0, budgets: [], recurring: 0, costed: 0, workarounds: 0, first: f.postedAt, last: f.postedAt, weeks: new Array(8).fill(0), trend: null };
      stats.set(f.problemId, s);
    }
    s.mentions++;
    s.people_.add(f.author ? `${f.source}:${f.author}` : `${f.source}:${f.title.toLowerCase().replace(/\s*--\s*\d+\s*$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`);
    if (!s.sources.includes(f.source)) s.sources.push(f.source);
    if (!s.communities.includes(f.community)) s.communities.push(f.community);
    if (f.source === "freelancer") {
      s.jobs++;
      if (f.budget) s.budgets.push(f.budget);
    }
    s.recurring += f.recurring;
    if (f.cost) s.costed++;
    if (f.workaround) s.workarounds++;
    if (f.postedAt < s.first) s.first = f.postedAt;
    if (f.postedAt > s.last) s.last = f.postedAt;
    const week = Math.floor((now - Date.parse(f.postedAt)) / WEEK);
    if (week >= 0 && week < 8) s.weeks[week]++;
  }
  for (const s of stats.values()) {
    s.people = s.people_.size;
    const [thisWeek, lastWeek] = s.weeks;
    const before = s.weeks.slice(1, 5).reduce((a, b) => a + b, 0);
    if (now - Date.parse(s.first) < WEEK && thisWeek >= 2) s.trend = "new";
    else if (thisWeek >= 3 && thisWeek >= (2 * before) / 4) s.trend = "rising";
    else if (s.weeks.slice(0, 4).filter((n) => n > 0).length >= 3) s.trend = "steady";
    else if (thisWeek === 0 && lastWeek === 0 && before >= 2) s.trend = "fading";
  }
  return new Map([...stats].map(([id, { people_: _, ...s }]) => [id, s]));
}
