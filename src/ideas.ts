// The ideas radar's sort and its counts. Every 3 hours the ideas task collects posts
// (scripts/collect-posts.ts); then prepareSort writes the kept posts no sort has seen yet, and the
// problems so far, into the run directory, haiku says which problem each post raises (opening a new
// one when none fits) along with what the post says about it, and saveSortOutput stores that in the
// problems and mentions tables. The counting is code (board): people, sources, paid jobs, weeks, and a
// trend label. The model never counts.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { latestVerdicts, listProblems, mentionFacts, problemMentions, saveSort, saveVerdicts, unsortedPosts, type Mention, type PostRow, type ProblemRow, type Score, type VerdictRow } from "./db.ts";
import { mentions } from "./mute.ts";
import type { TaskConfig } from "./runner.ts";

// The task that collects and sorts; its never-show list is the radar's.
export const RADAR = "ideas";

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

// The verdict: whether a problem is worth a small team testing as a business. The model answers fixed
// questions with evidence (judgeSchema); code turns the answers into the verdict (verdictOf), so it does
// not drift from run to run. A problem is judged once it has the evidence (`judgeBar`), again when its
// mentions have grown by half or its verdict is a month old, and whenever the page asks.
export const QUESTIONS: Record<string, { label: string; ask: string }> = {
  pain: { label: "Pain", ask: "Does it come back, and what does it cost them? 5: every week or more, with hours or money named by several people. 3: recurring but mild, or costly but rare. 1: a one-off annoyance." },
  pay: { label: "Willing to pay", ask: "Are they already paying to deal with it? 5: job posts with budgets, a VA, an accountant or a tool they pay for and work around. 3: they say they would pay. 1: they expect it free." },
  gap: { label: "Gap", ask: "What exists, and why doesn't it solve it? Search for it. 5: nothing does it, or the tools that exist miss this case the way the posts say. 3: tools exist but are too dear or too complex for a small business. 1: good, cheap tools already do it and the posters just don't know." },
  build: { label: "Buildable", ask: "Could two or three people with AI ship a first version in weeks? 5: yes, on public APIs of tools they already use (Shopify, Square, Xero, QuickBooks, Google). 3: months, or one hard integration. 1: it means replacing a big platform, a licence, hardware, or data nobody can get." },
  reach: { label: "Reachable", ask: "Can you find and sell to these people? 5: a named trade that gathers in places you can name (the subreddit or forum itself, an app store). 1: anyone and nowhere in particular." },
  size: { label: "Size", ask: "How many such businesses in the UK and the US, at what monthly price? 5: 100,000 or more at $30 a month or more. 3: around 10,000. 1: a few hundred. A rough guess, said as one." },
};

export type Verdict = VerdictRow["verdict"];
export const VERDICTS: Record<Verdict, string> = { worth: "Worth testing", watch: "Watch", pass: "Pass" };

// Pass: a hard no, not buildable by a small team (build 2 or less), a market already served well (gap
// 1), or two weak answers. Worth testing: pain, willingness to pay and the gap all 4 or more, buildable
// and reachable 3 or more. Watch: everything between.
export function verdictOf(hardNo: string, scores: Record<string, Score>): Verdict {
  const n = (k: string) => scores[k]?.score ?? 0;
  const weak = Object.keys(QUESTIONS).filter((k) => n(k) <= 2).length;
  if (hardNo || n("build") <= 2 || n("gap") <= 1 || weak >= 2) return "pass";
  if (n("pain") >= 4 && n("pay") >= 4 && n("gap") >= 4 && n("build") >= 3 && n("reach") >= 3) return "worth";
  return "watch";
}

// Enough evidence to judge: 4 mentions from 3 people, or a paid job and 2 more posts.
export const judgeBar = (s: ProblemStats) => (s.mentions >= 4 && s.people >= 3) || (s.jobs >= 1 && s.mentions >= 3);

// The problems the next judge run takes, asked ones first, then those with the most people: open or
// starred, not muted, over the bar, and never judged, grown by half since, or judged 30 days ago.
export function toJudge(max: number, muted: string[], now = Date.now()): { p: ProblemRow; s: ProblemStats; last?: VerdictRow }[] {
  const stats = problemStats(now);
  const verdicts = latestVerdicts();
  return listProblems()
    .filter((p) => p.status !== "killed" && stats.has(p.id) && !muted.some((m) => mentions(`${p.name}\n${p.summary}`, m)))
    .map((p) => ({ p, s: stats.get(p.id)!, last: verdicts.get(p.id) }))
    .filter(({ p, s, last }) => p.judgeAsked || (judgeBar(s) && (!last || s.mentions >= last.mentions * 1.5 || now - Date.parse(last.createdAt) > 30 * 86_400_000)))
    .sort((a, b) => Number(!!b.p.judgeAsked) - Number(!!a.p.judgeAsked) || b.s.people - a.s.people)
    .slice(0, max);
}

export function judgeSchema() {
  const text = (description: string) => ({ type: "string", description });
  // Each question is two flat fields, `pain` and `pain_why`: given a nested { score, why }, Sonnet twice
  // sent bare numbers, was refused by the schema and wrote the whole answer again.
  const questions = Object.fromEntries(
    Object.entries(QUESTIONS).flatMap(([k, q]) => [
      [k, { type: "integer", minimum: 1, maximum: 5, description: `${q.label}, 1 to 5. ${q.ask}` }],
      [`${k}_why`, text(`Why that ${q.label.toLowerCase()} score, in one or two sentences of evidence: the posts, or what the search found.`)],
    ]),
  );
  return {
    type: "object",
    required: ["verdicts"],
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        description: "One per problem of problems.md, in any order.",
        items: {
          type: "object",
          required: ["problem", "hard_no", ...Object.keys(questions), "competitors", "market", "reason", "test"],
          additionalProperties: false,
          properties: {
            problem: { type: "integer", description: "The problem's number." },
            hard_no: text("\"\" or, when one of the hard no's applies, which one and why, in a sentence."),
            ...questions,
            competitors: {
              type: "array",
              description: "The tools the search found that do this or come close, at most 5, best known first. Empty when none.",
              items: {
                type: "object",
                required: ["name", "url", "note"],
                additionalProperties: false,
                properties: { name: text("Its name."), url: text("Its site, as found."), note: text("Its price if found, and why it does or doesn't solve this, in a sentence.") } ,
              },
            },
            market: text("The rough market: how many such businesses in the UK and the US, times a plausible monthly price, as a range, saying it is a guess."),
            reason: text("The case for and against in one paragraph of three to five sentences, plain, for someone deciding whether to spend a weekend on it."),
            test: text("The smallest test to run this week before building: a landing page posted where they gather, a concierge version done by hand, a template to sell. One or two sentences, specific to this problem."),
          },
        },
      },
    },
  };
}

// Writes problems.md: each problem to judge with its counts and the posts behind it. False when there is
// nothing to judge.
export async function prepareJudge(dir: string, config: TaskConfig, muted: string[]): Promise<{ problems: number }> {
  const { maxProblems = 5, mentionsEach = 15, bodyChars = 400 } = (config.judge ?? {}) as { maxProblems?: number; mentionsEach?: number; bodyChars?: number };
  const picked = toJudge(maxProblems, muted);
  const blocks = picked.map(({ p, s, last }) => {
    const facts = [
      `${s.people} people, ${s.mentions} mentions, from ${s.sources.join(", ")} (${s.communities.slice(0, 6).join(", ")})`,
      `${s.recurring} say it recurs, ${s.costed} name a cost, ${s.workarounds} describe a workaround`,
      s.jobs ? `${s.jobs} paid job posts, budgets: ${[...new Set(s.budgets)].slice(0, 6).join("; ")}` : "no paid job posts",
      `first seen ${s.first.slice(0, 10)}, last ${s.last.slice(0, 10)}${s.trend ? `, ${s.trend}` : ""}`,
      ...(last ? [`judged before on ${last.createdAt.slice(0, 10)} at ${last.mentions} mentions: ${VERDICTS[last.verdict]}`] : []),
    ];
    const posts = problemMentions(p.id)
      .slice(0, mentionsEach)
      .map((m) => {
        const body = m.post.body.length > bodyChars ? `${m.post.body.slice(0, bodyChars)}…` : m.post.body;
        const by = [m.post.community, m.post.postedAt.slice(0, 10), m.post.budget && `budget ${m.post.budget}`].filter(Boolean).join(" · ");
        const read = [m.recurring && "recurs", m.cost && `cost: ${m.cost}`, m.workaround && `today: ${m.workaround}`].filter(Boolean).join("; ");
        return `- ${by}\n  ${m.post.title}${body ? `\n  ${body.replace(/\n+/g, " ")}` : ""}${read ? `\n  (${read})` : ""}`;
      });
    return `## Problem ${p.id}: ${p.name}\n\nCategory: ${p.category}. ${p.summary}\n\n${facts.map((f) => `- ${f}`).join("\n")}\n\nThe posts, newest first:\n\n${posts.join("\n")}`;
  });
  await writeFile(join(dir, "problems.md"), `# Problems to judge (${picked.length})\n\n${blocks.join("\n\n")}\n`);
  await writeFile(join(dir, "judge.json"), JSON.stringify(picked.map(({ p, s }) => ({ id: p.id, mentions: s.mentions }))));
  return { problems: picked.length };
}

type JudgeOutput = {
  verdicts: ({ problem: number; hard_no: string; competitors: { name: string; url: string; note: string }[]; market: string; reason: string; test: string } & Record<string, unknown>)[];
};

// Stores a verdict for every judged problem the answer covers, derived by verdictOf. Returns output.md.
export async function saveJudgeOutput(runId: string, output: unknown, dir: string): Promise<string | null> {
  const out = output as JudgeOutput | undefined;
  if (!out || !Array.isArray(out.verdicts)) return null;
  const picked = JSON.parse(await readFile(join(dir, "judge.json"), "utf8")) as { id: number; mentions: number }[];
  const counts = new Map(picked.map((p) => [p.id, p.mentions]));
  const rows: Omit<VerdictRow, "id" | "createdAt">[] = [];
  for (const v of out.verdicts) {
    if (!counts.has(v?.problem) || rows.some((r) => r.problemId === v.problem)) continue;
    const scores = Object.fromEntries(
      Object.keys(QUESTIONS).map((k) => [k, { score: Math.min(5, Math.max(1, Math.round(Number(v[k]) || 1))), why: String(v[`${k}_why`] ?? "").trim() }]),
    );
    const hardNo = String(v.hard_no ?? "").trim();
    const competitors = (Array.isArray(v.competitors) ? v.competitors : []).slice(0, 5).map((c) => ({ name: String(c?.name ?? "").trim(), url: /^https?:\/\//.test(String(c?.url)) ? String(c.url) : "", note: String(c?.note ?? "").trim() })).filter((c) => c.name);
    rows.push({ problemId: v.problem, verdict: verdictOf(hardNo, scores), hardNo, scores, competitors, size: String(v.market ?? "").trim(), reason: String(v.reason ?? "").trim(), test: String(v.test ?? "").trim(), mentions: counts.get(v.problem)! });
  }
  if (!rows.length) return null;
  saveVerdicts(runId, rows);
  const names = new Map(listProblems().map((p) => [p.id, p.name]));
  return [
    `# Verdicts, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    ...rows.map((r) => `- ${r.problemId}: ${names.get(r.problemId) ?? "?"}: **${VERDICTS[r.verdict]}** (${Object.entries(r.scores).map(([k, v]) => `${k} ${v.score}`).join(", ")})${r.hardNo ? `, hard no: ${r.hardNo}` : ""}`),
    ...(picked.length > rows.length ? ["", `${picked.length - rows.length} problems were left out of the answer and wait for the next run.`] : []),
  ].join("\n") + "\n";
}
