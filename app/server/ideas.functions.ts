import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { getProblem, getRun, latestVerdicts, listBriefs, listMutes, listProblems, problemMentions, problemVerdicts, radarTotals, type BriefRow, type ProblemRow, type VerdictRow } from "#src/db.ts";
import { BRIEF_GROUPS, CATEGORIES, QUESTIONS, VERDICTS, judgeBar, problemStats, type ProblemStats, type Trend, type Verdict } from "#src/ideas.ts";
import { mentions } from "#src/mute.ts";
import { listRuns, listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { isRunning, isWaiting } from "#src/scheduler.ts";
import { taskSources, type TaskSources } from "#src/sources.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDate, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect and sort the posts (tasks/ideas), and the one that judges (tasks/ideas-judge).
const TASK = "ideas";
const JUDGE = "ideas-judge";
const BRIEF = "ideas-brief";

export type ProblemItem = {
  id: number;
  name: string;
  category: string;
  summary: string;
  trend: Trend | null;
  status: string;
  verdict: Verdict | null;
  people: number;
  mentions: number;
  sources: string[];
  jobs: number;
  budgets: string[];
  recurring: number;
  costed: number;
  workarounds: number;
  first: string;
  last: string;
  /** Mentions per week, oldest first, the last one this week. */
  weeks: number[];
};
export type BriefView = {
  id: number;
  when: string;
  /** Written in the last 12 hours: the board shows it open, an older one closed. */
  fresh: boolean;
  since: string;
  summary: string;
  groups: { group: string; items: { problem: number; name: string; text: string }[] }[];
  next: string;
};
export type BriefState = {
  /** The newest brief, or every brief on the briefs page. */
  briefs: BriefView[];
  /** A brief is being written (Brief me was pressed and the run is going or waiting). */
  briefing: boolean;
  canBrief: boolean;
  /** The last Brief me that wrote no brief: it failed, was cut off, or found nothing to brief on. */
  lastRun: { failed: boolean; text: string; href: string } | null;
};
export type BriefsPage = { nav: Nav } & BriefState;
export type Show = Verdict | "starred" | "killed" | "unjudged";
export type IdeasPage = {
  nav: Nav;
  show?: Show;
  shows: { show: Show; label: string; count: number }[];
  categories: { slug: string; name: string; count: number }[];
  category?: string;
  all: boolean;
  problems: ProblemItem[];
  /** Problems left out of the default view, raised by one person so far. */
  oneOffs: number;
  /** Problems hidden because they mention a never-show phrase. */
  muted: number;
  totals: { posts: number; sorted: number; raising: number; problems: number; waiting: number };
  lastSort?: string;
  sources: TaskSources;
  brief: BriefState;
};
export type VerdictView = {
  verdict: Verdict;
  label: string;
  day: string;
  mentions: number;
  hardNo: string;
  scores: { key: string; label: string; score: number; why: string }[];
  competitors: VerdictRow["competitors"];
  size: string;
  reason: string;
  test: string;
};
export type ProblemPage = {
  nav: Nav;
  problem: ProblemItem;
  verdict?: VerdictView;
  earlier: { label: string; verdict: Verdict; day: string }[];
  /** Judge again was pressed and no judge run has answered yet; `judging` while one is going. */
  asked: boolean;
  judging: boolean;
  /** Whether the problem has the evidence the nightly run waits for. */
  overBar: boolean;
  canJudge: boolean;
  mergeTargets: { id: number; name: string }[];
  mentions: { url: string; title: string; community: string; day: string; author: string; budget: string | null; quote: string; cost: string; workaround: string; recurring: boolean; body: string }[];
};

const slug = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Business ideas are the reader's own shortlist: behind the admin cookie like the newsletters, a login
// without it and a 404 without ADMIN_PASSWORD.
function gate(next: string) {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next, failed: undefined } });
  setResponseHeader("cache-control", "private, no-store");
}

function item(p: ProblemRow, s: ProblemStats, v?: VerdictRow): ProblemItem {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    summary: p.summary,
    trend: s.trend,
    status: p.status,
    verdict: v?.verdict ?? null,
    people: s.people,
    mentions: s.mentions,
    sources: s.sources,
    jobs: s.jobs,
    budgets: s.budgets,
    recurring: s.recurring,
    costed: s.costed,
    workarounds: s.workarounds,
    first: formatDay(s.first),
    last: formatDay(s.last),
    weeks: [...s.weeks].reverse(),
  };
}

function briefView(b: BriefRow, names: Map<number, string>): BriefView {
  return {
    id: b.id,
    when: formatDate(b.createdAt, "Europe/London"),
    fresh: Date.now() - Date.parse(b.createdAt) < 12 * 3_600_000,
    since: formatDay(b.since, "Europe/London"),
    summary: b.summary,
    groups: BRIEF_GROUPS.map((group) => ({
      group,
      items: b.items.filter((i) => i.group === group && names.has(i.problem)).map((i) => ({ problem: i.problem, name: names.get(i.problem)!, text: i.text })),
    })).filter((g) => g.items.length),
    next: b.next,
  };
}

async function briefState(limit: number): Promise<BriefState> {
  const names = new Map(listProblems().map((p) => [p.id, p.name]));
  const briefs = listBriefs(limit);
  const briefing = isRunning(BRIEF) || isWaiting(BRIEF);
  return {
    briefs: briefs.map((b) => briefView(b, names)),
    briefing,
    canBrief: (await listTasks()).includes(BRIEF),
    lastRun: briefing ? null : lastBriefRun(briefs[0]),
  };
}

// Brief me went back to the button with nothing new to show when its run failed or had nothing to
// brief on, which looked like a button that does nothing. The page says what became of it instead:
// the newest brief run, when it started after the newest brief and wrote none. A row still `running`
// that this server is not running was cut off.
function lastBriefRun(latest: BriefRow | undefined): BriefState["lastRun"] {
  const run = listRuns(BRIEF)[0];
  if (!run || (latest && run.startedAt <= latest.createdAt)) return null;
  const when = formatDate(run.startedAt, "Europe/London");
  const href = `/admin/runs/${BRIEF}/${run.runId}`;
  if (run.status !== "ok") return { failed: true, text: `The brief asked for on ${when} ${run.status === "running" ? "was cut off" : "failed"}.`, href };
  const note = (getRun(BRIEF, run.runId)?.output ?? "").trim();
  return { failed: false, text: `No brief on ${when}. ${note || "The run wrote none."}`, href };
}

// The order of the board: starred first, then by verdict (worth testing, watch, not judged yet, pass),
// then the most people, the busiest this week, the latest.
const RANK: Record<string, number> = { worth: 0, watch: 1, none: 2, pass: 3 };
type Row = { p: ProblemRow; s: ProblemStats; v?: VerdictRow };
const byEvidence = (a: Row, b: Row) =>
  Number(b.p.status === "starred") - Number(a.p.status === "starred") ||
  RANK[a.v?.verdict ?? "none"] - RANK[b.v?.verdict ?? "none"] ||
  b.s.people - a.s.people ||
  b.s.weeks[0] - a.s.weeks[0] ||
  b.s.last.localeCompare(a.s.last);

const SHOWS: Record<Show, { label: string; has: (r: Row) => boolean }> = {
  worth: { label: VERDICTS.worth, has: (r) => r.v?.verdict === "worth" && r.p.status !== "killed" },
  watch: { label: VERDICTS.watch, has: (r) => r.v?.verdict === "watch" && r.p.status !== "killed" },
  unjudged: { label: "Not judged", has: (r) => !r.v && r.p.status !== "killed" },
  pass: { label: VERDICTS.pass, has: (r) => r.v?.verdict === "pass" && r.p.status !== "killed" },
  starred: { label: "Starred", has: (r) => r.p.status === "starred" },
  killed: { label: "Killed", has: (r) => r.p.status === "killed" },
};

// The board: every problem with a mention, counted by code (src/ideas.ts), in a category or all of
// them. By default only problems more than one person raised; `all` adds the one-offs.
export const getIdeasPage = createServerFn({ method: "GET" })
  .validator((data: { category?: string; all?: boolean; show?: string }) => data)
  .handler(async ({ data }): Promise<IdeasPage> => {
    gate(`/ideas${data.category ? `?category=${data.category}` : ""}`);
    const { configs: _, ...sidebar } = await nav();
    const config = await loadTask(TASK).then((t) => t.config, () => ({}) as TaskConfig);
    const names = (config.categories as string[] | undefined) ?? CATEGORIES;
    const stats = problemStats();
    const muted = listMutes(TASK);
    const isMuted = (p: ProblemRow) => muted.some((m) => mentions(`${p.name}\n${p.summary}`, m));
    const verdicts = latestVerdicts();
    const counted: Row[] = listProblems().flatMap((p) => (stats.has(p.id) ? [{ p, s: stats.get(p.id)!, v: verdicts.get(p.id) }] : []));
    const unmuted = counted.filter(({ p }) => !isMuted(p));
    const category = data.category ? names.find((n) => slug(n) === data.category) : undefined;
    if (data.category && !category) throw notFound();
    const show = data.show && data.show in SHOWS ? (data.show as Show) : undefined;
    if (data.show && !show) throw notFound();
    // Killed problems only under their own chip.
    const shown = unmuted.filter((r) => (show ? SHOWS[show].has(r) : r.p.status !== "killed"));
    const inCategory = shown.filter(({ p }) => !category || p.category === category);
    // A judged or starred problem is always shown; the one-off filter is for the rest.
    const visible = inCategory.filter((r) => data.all || r.s.people > 1 || r.v || r.p.status === "starred").sort(byEvidence);
    // The last run that sorted something (a run with nothing to sort costs nothing and has no cost).
    const lastSort = listRuns(TASK).find((r) => r.status === "ok" && r.costUsd !== undefined);
    const totals = radarTotals();
    return {
      nav: sidebar,
      categories: names.map((n) => ({ slug: slug(n), name: n, count: shown.filter((r) => r.p.category === n && (data.all || r.s.people > 1 || r.v || r.p.status === "starred")).length })),
      category: category && slug(category),
      show,
      shows: (Object.keys(SHOWS) as Show[]).map((k) => ({ show: k, label: SHOWS[k].label, count: unmuted.filter((r) => SHOWS[k].has(r) && (!category || r.p.category === category)).length })),
      all: !!data.all,
      problems: visible.map(({ p, s, v }) => item(p, s, v)),
      oneOffs: data.all ? 0 : inCategory.length - visible.length,
      muted: counted.length - shown.length,
      totals: { ...totals, waiting: totals.posts - totals.sorted },
      lastSort: lastSort && ago(lastSort.finishedAt ?? lastSort.startedAt),
      sources: await taskSources(TASK, config),
      brief: await briefState(1),
    };
  });

// One problem with every post that raised it, newest first.
export const getProblemPage = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<ProblemPage> => {
    gate(`/ideas/${data.id}`);
    const { configs: _, ...sidebar } = await nav();
    const problem = /^\d+$/.test(data.id) ? getProblem(Number(data.id)) : null;
    // A merged problem's page is the one it went into.
    if (problem?.status === "merged" && problem.mergedInto) throw redirect({ to: "/ideas/$id", params: { id: String(problem.mergedInto) } });
    const all = problemStats();
    const stats = problem && all.get(problem.id);
    if (!problem || !stats) throw notFound();
    const [latest, ...older] = problemVerdicts(problem.id);
    const day = (v: VerdictRow) => formatDay(v.createdAt);
    return {
      nav: sidebar,
      problem: item(problem, stats, latest),
      verdict: latest && {
        verdict: latest.verdict,
        label: VERDICTS[latest.verdict],
        day: day(latest),
        mentions: latest.mentions,
        hardNo: latest.hardNo,
        scores: Object.entries(QUESTIONS).map(([key, q]) => ({ key, label: q.label, score: latest.scores[key]?.score ?? 0, why: latest.scores[key]?.why ?? "" })),
        competitors: latest.competitors,
        size: latest.size,
        reason: latest.reason,
        test: latest.test,
      },
      earlier: older.map((v) => ({ label: VERDICTS[v.verdict], verdict: v.verdict, day: day(v) })),
      asked: !!problem.judgeAsked,
      judging: !!problem.judgeAsked && (isRunning(JUDGE) || isWaiting(JUDGE)),
      overBar: judgeBar(stats),
      canJudge: (await listTasks()).includes(JUDGE),
      mergeTargets: listProblems()
        .filter((p) => p.id !== problem.id && p.category === problem.category && all.has(p.id))
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      mentions: problemMentions(problem.id).map((m) => ({
        url: m.post.url,
        title: m.post.title,
        community: m.post.community,
        day: formatDay(m.post.postedAt),
        author: m.post.author,
        budget: m.post.budget,
        quote: m.quote,
        cost: m.cost,
        workaround: m.workaround,
        recurring: m.recurring,
        body: m.post.body,
      })),
    };
  });

// Every brief, newest first.
export const getBriefsPage = createServerFn({ method: "GET" }).handler(async (): Promise<BriefsPage> => {
  gate("/ideas/briefs");
  const { configs: _, ...sidebar } = await nav();
  return { nav: sidebar, ...(await briefState(100)) };
});
