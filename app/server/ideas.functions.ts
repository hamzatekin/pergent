import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { getProblem, listMutes, listProblems, problemMentions, radarTotals, type ProblemRow } from "#src/db.ts";
import { CATEGORIES, problemStats, type ProblemStats, type Trend } from "#src/ideas.ts";
import { mentions } from "#src/mute.ts";
import { listRuns, loadTask, type TaskConfig } from "#src/runner.ts";
import { taskSources, type TaskSources } from "#src/sources.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect and sort the posts (tasks/ideas).
const TASK = "ideas";

export type ProblemItem = {
  id: number;
  name: string;
  category: string;
  summary: string;
  trend: Trend | null;
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
export type IdeasPage = {
  nav: Nav;
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
};
export type ProblemPage = {
  nav: Nav;
  problem: ProblemItem;
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

function item(p: ProblemRow, s: ProblemStats): ProblemItem {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    summary: p.summary,
    trend: s.trend,
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

// The order of the board: the most people first, then the busiest this week, then the latest.
const byEvidence = (a: { s: ProblemStats }, b: { s: ProblemStats }) => b.s.people - a.s.people || b.s.weeks[0] - a.s.weeks[0] || b.s.last.localeCompare(a.s.last);

// The board: every problem with a mention, counted by code (src/ideas.ts), in a category or all of
// them. By default only problems more than one person raised; `all` adds the one-offs.
export const getIdeasPage = createServerFn({ method: "GET" })
  .validator((data: { category?: string; all?: boolean }) => data)
  .handler(async ({ data }): Promise<IdeasPage> => {
    gate(`/ideas${data.category ? `?category=${data.category}` : ""}`);
    const { configs: _, ...sidebar } = await nav();
    const config = await loadTask(TASK).then((t) => t.config, () => ({}) as TaskConfig);
    const names = (config.categories as string[] | undefined) ?? CATEGORIES;
    const stats = problemStats();
    const muted = listMutes(TASK);
    const isMuted = (p: ProblemRow) => muted.some((m) => mentions(`${p.name}\n${p.summary}`, m));
    const counted = listProblems().flatMap((p) => (stats.has(p.id) ? [{ p, s: stats.get(p.id)! }] : []));
    const shown = counted.filter(({ p }) => !isMuted(p));
    const category = data.category ? names.find((n) => slug(n) === data.category) : undefined;
    if (data.category && !category) throw notFound();
    const inCategory = shown.filter(({ p }) => !category || p.category === category);
    const visible = inCategory.filter(({ s }) => data.all || s.people > 1).sort(byEvidence);
    // The last run that sorted something (a run with nothing to sort costs nothing and has no cost).
    const lastSort = listRuns(TASK).find((r) => r.status === "ok" && r.costUsd !== undefined);
    const totals = radarTotals();
    return {
      nav: sidebar,
      categories: names.map((n) => ({ slug: slug(n), name: n, count: shown.filter(({ p, s }) => p.category === n && (data.all || s.people > 1)).length })),
      category: category && slug(category),
      all: !!data.all,
      problems: visible.map(({ p, s }) => item(p, s)),
      oneOffs: data.all ? 0 : inCategory.length - visible.length,
      muted: counted.length - shown.length,
      totals: { ...totals, waiting: totals.posts - totals.sorted },
      lastSort: lastSort && ago(lastSort.finishedAt ?? lastSort.startedAt),
      sources: await taskSources(TASK, config),
    };
  });

// One problem with every post that raised it, newest first.
export const getProblemPage = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<ProblemPage> => {
    gate(`/ideas/${data.id}`);
    const { configs: _, ...sidebar } = await nav();
    const problem = /^\d+$/.test(data.id) ? getProblem(Number(data.id)) : null;
    const stats = problem && problemStats().get(problem.id);
    if (!problem || !stats) throw notFound();
    return {
      nav: sidebar,
      problem: item(problem, stats),
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
