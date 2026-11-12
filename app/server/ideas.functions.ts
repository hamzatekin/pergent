import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { getProblem, getRun, latestOverview, latestVerdicts, listMutes, listProblems, problemMentions, problemVerdicts, radarTotals, type OverviewRow, type ProblemRow, type VerdictRow } from "#src/db.ts";
import { QUESTIONS, RADAR, VERDICTS, categoriesOf, judgeBar, judgeOf, overviewOf, problemStats, type ProblemStats, type Trend, type Verdict } from "#src/ideas.ts";
import { mentions } from "#src/mute.ts";
import { listRuns, listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { isRunning, isWaiting } from "#src/scheduler.ts";
import { taskSources, type TaskSources } from "#src/sources.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDate, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// A radar is the task whose runs collect and sort its posts (tasks/ideas, tasks/gym); its judge and its
// overview, when it has them, are the tasks named after it (judgeOf and overviewOf in src/ideas.ts).

// Every radar, the small business one first: the tasks that sort posts, with the name the page shows.
async function radars(): Promise<{ task: string; label: string }[]> {
  const out: { task: string; label: string }[] = [];
  for (const task of await listTasks()) {
    const config = await loadTask(task).then((t) => t.config, () => null);
    if (config?.output === "sort") out.push({ task, label: (config.radarLabel as string | undefined) ?? config.label ?? task });
  }
  return out.sort((a, b) => Number(b.task === RADAR) - Number(a.task === RADAR));
}

export type ProblemItem = {
  id: number;
  /** The radar it belongs to. */
  task: string;
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
export type IdeaView = {
  name: string;
  pitch: string;
  why: string;
  risk: string;
  first: string;
  best: boolean;
  /** The category it came from, for the best bets on the home page. */
  category: { slug: string; name: string };
  problems: { id: number; name: string }[];
};
export type OverviewState = {
  /** When the newest overview was written; null before the first. */
  when: string | null;
  /** Written in the last 36 hours: older, the page says it is old. */
  fresh: boolean;
  /** An overview is being written (Refresh was pressed, or the nightly run is going or waiting). */
  writing: boolean;
  canWrite: boolean;
  /** The newest overview run that wrote none since: it failed, or found nothing new. */
  lastRun: { failed: boolean; text: string; href: string } | null;
};
export type RadarTab = { task: string; label: string };
export type Show = Verdict | "starred" | "killed" | "unjudged";
type Board = {
  nav: Nav;
  radar: string;
  radars: RadarTab[];
  /** Problems hidden because they mention a never-show phrase. */
  muted: number;
  /** Null for a radar without an overview task. */
  overview: OverviewState | null;
};
export type CategoryCard = {
  slug: string;
  name: string;
  /** Raised by more than one person, or judged or starred. */
  problems: number;
  /** Raised by one person so far, not killed. */
  oneOffs: number;
  people: number;
  worth: number;
  watch: number;
  ideas: number;
  take: string | null;
};
// The home of a radar: the overview's summary and best bets, then a card per category.
export type IdeasHome = Board & {
  kind: "home";
  summary: string | null;
  best: IdeaView[];
  categories: CategoryCard[];
  /** The reader's starred problems, whatever their category. */
  starred: ProblemItem[];
  totals: { posts: number; sorted: number; raising: number; problems: number; waiting: number };
  lastSort?: string;
  sources: TaskSources;
};
// One category: what the overview made of it, then its problems.
export type IdeasCategory = Board & {
  kind: "category";
  category: { slug: string; name: string; take: string | null; summary: string | null; ideas: IdeaView[] };
  categories: { slug: string; name: string; count: number }[];
  show?: Show;
  shows: { show: Show; label: string; count: number }[];
  all: boolean;
  problems: ProblemItem[];
  /** Problems left out of the default view, raised by one person so far. */
  oneOffs: number;
};
export type IdeasPage = IdeasHome | IdeasCategory;
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
  /** The radar's name, when there is more than one. */
  radarLabel?: string;
  problem: ProblemItem;
  /** The problem's category on the Ideas page. */
  categorySlug: string;
  verdict?: VerdictView;
  earlier: { label: string; verdict: Verdict; day: string }[];
  /** Judge again was pressed and no judge run has answered yet; `judging` while one is going. */
  asked: boolean;
  judging: boolean;
  /** Whether the problem has the evidence the nightly run waits for. */
  overBar: boolean;
  canJudge: boolean;
  mergeTargets: { id: number; name: string }[];
  mentions: { id: string; url: string; title: string; community: string; day: string; author: string; budget: string | null; quote: string; cost: string; workaround: string; recurring: boolean; body: string }[];
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
    task: p.task,
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

// The newest overview run that wrote none after the newest overview: failed or cut off (a row still
// `running` that this server is not running), or ended without claude because nothing was new.
function lastOverviewRun(task: string, latest: OverviewRow | null): OverviewState["lastRun"] {
  const run = listRuns(task)[0];
  if (!run || (latest && run.startedAt <= latest.createdAt)) return null;
  const when = formatDate(run.startedAt, "Europe/London");
  const href = `/admin/runs/${task}/${run.runId}`;
  if (run.status !== "ok") return { failed: true, text: `The overview run on ${when} ${run.status === "running" ? "was cut off" : "failed"}.`, href };
  const note = (getRun(task, run.runId)?.output ?? "").trim();
  return { failed: false, text: `Checked again ${when}: ${note || "the run wrote none."}`, href };
}

async function overviewState(radar: string, latest: OverviewRow | null): Promise<OverviewState | null> {
  const task = overviewOf(radar);
  if (!(await listTasks()).includes(task)) return null;
  const writing = isRunning(task) || isWaiting(task);
  return {
    when: latest && formatDate(latest.createdAt, "Europe/London"),
    fresh: !!latest && Date.now() - Date.parse(latest.createdAt) < 36 * 3_600_000,
    writing,
    canWrite: true,
    lastRun: writing ? null : lastOverviewRun(task, latest),
  };
}

// The order of a category's problems: starred first, then by verdict (worth testing, watch, not judged
// yet, pass), then the most people, the busiest this week, the latest.
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

// Shown by default: raised by more than one person, or judged, or starred. A one-off waits for a second.
const onBoard = (r: Row) => r.s.people > 1 || !!r.v || r.p.status === "starred";

// A radar's Ideas page. Without a category, its home: the nightly overview's summary of the whole board
// and the ideas it would start with, then a card per category with its counts and the overview's one
// line. With one, the category: what the overview made of it, the businesses one person could build
// from it, then its problems, counted by code (src/ideas.ts), the one-offs behind a link.
export const getIdeasPage = createServerFn({ method: "GET" })
  .validator((data: { radar?: string; category?: string; all?: boolean; show?: string }) => data)
  .handler(async ({ data }): Promise<IdeasPage> => {
    const query = new URLSearchParams(Object.entries({ radar: data.radar, category: data.category }).filter((e): e is [string, string] => !!e[1])).toString();
    gate(`/ideas${query ? `?${query}` : ""}`);
    const { configs: _, ...sidebar } = await nav();
    const all = await radars();
    const TASK = data.radar ?? RADAR;
    if (!all.some((r) => r.task === TASK)) throw notFound();
    const config = await loadTask(TASK).then((t) => t.config, () => ({}) as TaskConfig);
    const names = categoriesOf(config);
    const stats = problemStats(TASK);
    const muted = listMutes(TASK);
    const isMuted = (p: ProblemRow) => muted.some((m) => mentions(`${p.name}\n${p.summary}`, m));
    const verdicts = latestVerdicts();
    const problems = listProblems(TASK);
    const counted: Row[] = problems.flatMap((p) => (stats.has(p.id) ? [{ p, s: stats.get(p.id)!, v: verdicts.get(p.id) }] : []));
    const unmuted = counted.filter(({ p }) => !isMuted(p));
    const live = unmuted.filter((r) => r.p.status !== "killed");
    const latest = latestOverview(TASK);
    const problemNames = new Map(problems.map((p) => [p.id, p.name]));
    const ideasOf = (c: OverviewRow["categories"][number]): IdeaView[] =>
      c.ideas.map((i) => ({
        ...i,
        category: { slug: slug(c.category), name: c.category },
        problems: i.problems.filter((id) => problemNames.has(id)).map((id) => ({ id, name: problemNames.get(id)! })),
      }));
    const board: Board = {
      nav: sidebar,
      radar: TASK,
      radars: all.length > 1 ? all : [],
      muted: counted.length - unmuted.length,
      overview: await overviewState(TASK, latest),
    };

    if (!data.category) {
      const lastSort = listRuns(TASK).find((r) => r.status === "ok" && r.costUsd !== undefined);
      const totals = radarTotals(TASK);
      return {
        ...board,
        kind: "home",
        summary: latest?.summary ?? null,
        best: (latest?.categories ?? []).flatMap(ideasOf).filter((i) => i.best),
        categories: names
          .map((name) => {
            const here = live.filter((r) => r.p.category === name && onBoard(r));
            const o = latest?.categories.find((c) => c.category === name);
            return {
              slug: slug(name),
              name,
              problems: here.length,
              oneOffs: live.filter((r) => r.p.category === name && !onBoard(r)).length,
              people: here.reduce((n, r) => n + r.s.people, 0),
              worth: here.filter((r) => r.v?.verdict === "worth").length,
              watch: here.filter((r) => r.v?.verdict === "watch").length,
              ideas: o?.ideas.length ?? 0,
              take: o?.take || null,
            };
          })
          // Every category with a problem, so one with only one-offs or killed problems can still be opened.
          .filter((c) => unmuted.some((r) => r.p.category === c.name)),
        starred: unmuted.filter((r) => r.p.status === "starred").sort(byEvidence).map(({ p, s, v }) => item(p, s, v)),
        totals: { ...totals, waiting: totals.posts - totals.sorted },
        lastSort: lastSort && ago(lastSort.finishedAt ?? lastSort.startedAt),
        sources: await taskSources(TASK, config),
      };
    }

    const category = names.find((n) => slug(n) === data.category);
    if (!category) throw notFound();
    const show = data.show && data.show in SHOWS ? (data.show as Show) : undefined;
    if (data.show && !show) throw notFound();
    const inCategory = unmuted.filter((r) => r.p.category === category);
    // Killed problems only under their own chip.
    const shown = inCategory.filter((r) => (show ? SHOWS[show].has(r) : r.p.status !== "killed"));
    const visible = shown.filter((r) => data.all || onBoard(r)).sort(byEvidence);
    const o = latest?.categories.find((c) => c.category === category);
    return {
      ...board,
      kind: "category",
      category: { slug: slug(category), name: category, take: o?.take || null, summary: o?.summary || null, ideas: o ? ideasOf(o) : [] },
      categories: names.map((n) => ({ slug: slug(n), name: n, count: live.filter((r) => r.p.category === n && onBoard(r)).length })).filter((c) => c.name === category || unmuted.some((r) => r.p.category === c.name)),
      show,
      shows: (Object.keys(SHOWS) as Show[]).map((k) => ({ show: k, label: SHOWS[k].label, count: inCategory.filter((r) => SHOWS[k].has(r)).length })),
      all: !!data.all,
      problems: visible.map(({ p, s, v }) => item(p, s, v)),
      oneOffs: data.all ? 0 : shown.length - visible.length,
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
    const all = problem ? problemStats(problem.task) : new Map<number, ProblemStats>();
    const stats = problem && all.get(problem.id);
    if (!problem || !stats) throw notFound();
    const JUDGE = judgeOf(problem.task);
    const tabs = await radars();
    const [latest, ...older] = problemVerdicts(problem.id);
    const day = (v: VerdictRow) => formatDay(v.createdAt);
    return {
      nav: sidebar,
      radarLabel: tabs.length > 1 ? tabs.find((r) => r.task === problem.task)?.label : undefined,
      problem: item(problem, stats, latest),
      categorySlug: slug(problem.category),
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
      mergeTargets: listProblems(problem.task)
        .filter((p) => p.id !== problem.id && p.category === problem.category && all.has(p.id))
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      mentions: problemMentions(problem.id).map((m) => ({
        id: m.post.id,
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
