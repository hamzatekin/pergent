import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import { getProblem, getRun, latestOverview, latestResearch, latestVerdicts, listMutes, listProblems, problemMentions, problemVerdicts, radarTotals, type OverviewRow, type ProblemRow, type ResearchRow, type VerdictRow } from "#src/db.ts";
import { QUESTIONS, RADAR, VERDICTS, categoriesOf, judgeBar, judgeOf, overviewOf, problemStats, researchOf, toJudge, type ProblemStats, type Trend, type Verdict } from "#src/ideas.ts";
import { mentions } from "#src/mute.ts";
import { listRuns, listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { isRunning, isWaiting } from "#src/scheduler.ts";
import { taskSources, type TaskSources } from "#src/sources.ts";
import { type IdeasView, ideasViewCookieName, isIdeasView } from "../ideas-view.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDate, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// A radar is the task whose runs collect and sort its posts (tasks/ideas, tasks/gym); its judge, research
// and overview, when it has them, are the tasks named after it (judgeOf, researchOf and overviewOf in
// src/ideas.ts).

// Every radar, the small business one first: the tasks that sort posts, with the name the page shows.
async function radars(): Promise<{ task: string; label: string }[]> {
  const out: { task: string; label: string }[] = [];
  for (const task of await listTasks()) {
    const config = await loadTask(task).then((t) => t.config, () => null);
    if (config?.output === "sort") out.push({ task, label: (config.radarLabel as string | undefined) ?? config.label ?? task });
  }
  return out.sort((a, b) => Number(b.task === RADAR) - Number(a.task === RADAR));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The six questions a verdict scores, asked the way the Ideas page asks them, with the word for a weak
// answer: a problem's weak spot is its lowest score of 3 or less.
const ASKS: Record<string, { ask: string; short: string; weak: string }> = {
  pain: { ask: "Does it hurt?", short: "Hurts", weak: "Mild pain" },
  pay: { ask: "Do they pay?", short: "They pay", weak: "Few pay" },
  gap: { ask: "Is there room?", short: "Room left", weak: "Crowded" },
  build: { ask: "Can I build it?", short: "Buildable", weak: "Hard to build alone" },
  reach: { ask: "Can I reach them?", short: "Reachable", weak: "Hard to reach" },
  size: { ask: "Is it big enough?", short: "Size", weak: "Small market" },
};

export type Ask = { key: string; ask: string; short: string; score: number; why: string };
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
  /** The latest verdict's six answers in QUESTIONS order; null when it has none. */
  asks: Ask[] | null;
  /** The six scores summed, out of 30. */
  fit: number | null;
  /** Its lowest score when that is 3 or less, said plainly ("Crowded: Chaser, Jobber"), and the verdict's reason. */
  weak: { label: string; score: number; why: string } | null;
  /** The verdict's smallest test. */
  test: string;
};
/** A problem's newest research (src/ideas.ts): the three ways, what exists, worth competing, the better solution. */
export type ResearchView = Pick<ResearchRow, "approaches" | "products" | "worth" | "worthWhy" | "better"> & { day: string; madeAt: string | null };
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
/** The sets of problems the brief's list can show. */
export type Show = "top" | "unjudged" | "pass" | "starred" | "killed" | "oneoffs";
/**
 * The problem that leads the brief: researched and worth competing on (the only best bet), else the best
 * judged not researched yet, else the best judged the research found not worth it, else the one most
 * people raised.
 */
export type BestBet = {
  why: "researched" | "judged" | "rejected" | "people";
  research: ResearchView | null;
  problem: ProblemItem;
  quotes: { text: string; where: string; day: string; url: string }[];
};
export type BoardColumn = { key: string; label: string; hint: string; items: ProblemItem[]; total: number; more?: Show };
export type IdeasPage = {
  nav: Nav;
  radar: string;
  radars: RadarTab[];
  /** Problems hidden because they mention a never-show phrase. */
  muted: number;
  /** Null for a radar without an overview task. */
  overview: OverviewState | null;
  view: IdeasView;
  /** The reader's default view: their cookie, else the brief. */
  defaultView: IdeasView;
  /** What every link on the page keeps: the radar, the category and the view, each only when not the default. */
  query: { radar?: string; category?: string; view?: IdeasView };
  /** Whether the radar has a judge, so verdicts, and a research run. */
  judges: boolean;
  researches: boolean;
  categories: { slug: string; name: string; count: number }[];
  /** The category the page is filtered to, with the overview's one-line take on it. */
  category: { slug: string; name: string; take: string | null } | null;
  /** The overview's summary of the whole board, or of the category. */
  summary: string | null;
  headline: string;
  sub: string | null;
  /** From posts to verdicts, for the whole radar. */
  funnel: { collected: number; kept: number; problems: number; multi: number; judged: number; worth: number; watch: number; pass: number; researched: number; better: number };
  best: BestBet | null;
  /** First seen in the last 7 days, not judged yet. */
  fresh: ProblemItem[];
  /** What the next judge run takes. */
  tonight: ProblemItem[];
  brief?: { show: Show; shows: { show: Show; label: string; count: number }[]; list: ProblemItem[]; leadIn: boolean };
  map?: { dots: ProblemItem[]; passed: number; withPassed: boolean; selected: number | null };
  board?: { week: { problems: number; verdicts: number; posts: number | null }; columns: BoardColumn[]; passed: { items: ProblemItem[]; total: number }; unjudged: number };
  totals: { posts: number; sorted: number; problems: number; waiting: number };
  lastSort?: string;
  sources: TaskSources;
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
  research: ResearchView | null;
  /** Research this was pressed and no research run has answered yet; `researching` while one is going. */
  researchAsked: boolean;
  researching: boolean;
  /** Whether the radar has a research task. */
  canResearch: boolean;
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

function asksOf(v: VerdictRow): Ask[] {
  return Object.keys(QUESTIONS).map((key) => ({ key, ask: ASKS[key].ask, short: ASKS[key].short, score: v.scores[key]?.score ?? 0, why: v.scores[key]?.why ?? "" }));
}

// The lowest score, the first of equals in QUESTIONS order, when it is 3 or less. A low gap names what
// already exists.
function weakOf(v: VerdictRow, asks: Ask[]): ProblemItem["weak"] {
  const low = asks.reduce((a, b) => (b.score < a.score ? b : a));
  if (low.score > 3) return null;
  const names = v.competitors.slice(0, 2).map((c) => c.name);
  const label = low.key === "gap" && names.length ? `${ASKS.gap.weak}: ${names.join(", ")}` : ASKS[low.key].weak;
  return { label, score: low.score, why: low.why };
}

function item(p: ProblemRow, s: ProblemStats, v?: VerdictRow): ProblemItem {
  const asks = v ? asksOf(v) : null;
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
    asks,
    fit: asks?.reduce((n, a) => n + a.score, 0) ?? null,
    weak: v && asks ? weakOf(v, asks) : null,
    test: v?.test ?? "",
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

type Row = { p: ProblemRow; s: ProblemStats; v?: VerdictRow };
const fitOf = (r: Row) => (r.v ? Object.keys(QUESTIONS).reduce((n, k) => n + (r.v!.scores[k]?.score ?? 0), 0) : 0);
// Judged worth a look: Worth testing before Watch, then the six scores summed, then the most people.
const byFit = (a: Row, b: Row) => Number(b.v?.verdict === "worth") - Number(a.v?.verdict === "worth") || fitOf(b) - fitOf(a) || b.s.people - a.s.people;
// Everything else: the most people, the busiest this week, the latest.
const byPeople = (a: Row, b: Row) => b.s.people - a.s.people || b.s.weeks[0] - a.s.weeks[0] || b.s.last.localeCompare(a.s.last);

const looked = (r: Row) => r.v?.verdict === "worth" || r.v?.verdict === "watch";
// On the board: raised by more than one person, or judged, or starred. A one-off waits for a second.
const onBoard = (r: Row) => r.s.people > 1 || !!r.v || r.p.status === "starred";
const live = (r: Row) => r.p.status !== "killed";
const SHOWS: Record<Show, { label: string; has: (r: Row) => boolean; order: (a: Row, b: Row) => number }> = {
  top: { label: "Worth a look", has: (r) => live(r) && looked(r), order: byFit },
  unjudged: { label: "Not judged", has: (r) => live(r) && !r.v && onBoard(r), order: byPeople },
  pass: { label: "Passed", has: (r) => live(r) && r.v?.verdict === "pass", order: byPeople },
  starred: { label: "Starred", has: (r) => r.p.status === "starred", order: byFit },
  killed: { label: "Killed", has: (r) => r.p.status === "killed", order: byPeople },
  oneoffs: { label: "One-offs", has: (r) => live(r) && !onBoard(r), order: byPeople },
};
// Links from before the views kept one verdict each.
const LEGACY_SHOWS: Record<string, Show> = { worth: "top", watch: "top" };

const WEEK = 7 * 86_400_000;
const recentlyJudged = (r: Row) => !!r.v && Date.now() - Date.parse(r.v.createdAt) < WEEK;

// A research as the page shows it; given the problem's verdict now, `madeAt` says when the research was
// made at another.
const researchView = (r: ResearchRow, now?: string): ResearchView => ({
  day: formatDay(r.createdAt),
  madeAt: now === undefined || r.verdict === now ? null : r.verdict === "none" ? "before it was judged" : `when it was ${VERDICTS[r.verdict as Verdict] ?? r.verdict}`,
  approaches: r.approaches,
  products: r.products,
  worth: r.worth,
  worthWhy: r.worthWhy,
  better: r.better,
});

// The posts that say it best: up to two quotes of some length, those naming a cost or saying it recurs first.
function quotesOf(problemId: number): BestBet["quotes"] {
  return problemMentions(problemId)
    .filter((m) => m.quote.length >= 40)
    .sort((a, b) => Number(!!b.cost || b.recurring) - Number(!!a.cost || a.recurring))
    .slice(0, 2)
    .map((m) => ({ text: m.quote, where: m.post.community, day: formatDay(m.post.postedAt), url: m.post.url }));
}

// A radar's Ideas page in one of its three views. Every view starts from the same rows: the radar's
// problems with their counts (src/ideas.ts) and latest verdicts, never-show matches left out, filtered
// to ?category= when there is one. The brief leads with one problem and a sentence on the board, then a
// ranked list (?show= picks the set); the map places the judged problems by demand and by how winnable
// they are (?passed=true adds the passed ones, ?selected= the one opened); the board puts them in a
// column per stage.
export const getIdeasPage = createServerFn({ method: "GET" })
  .validator((data: { radar?: string; category?: string; view?: string; show?: string; passed?: boolean; selected?: number }) => data)
  .handler(async ({ data }): Promise<IdeasPage> => {
    const search = new URLSearchParams(Object.entries({ radar: data.radar, category: data.category, view: data.view }).filter((e): e is [string, string] => !!e[1])).toString();
    gate(`/ideas${search ? `?${search}` : ""}`);
    const { configs: _, ...sidebar } = await nav();
    const all = await radars();
    const TASK = data.radar ?? RADAR;
    if (!all.some((r) => r.task === TASK)) throw notFound();
    const chosen = getCookie(ideasViewCookieName);
    const defaultView: IdeasView = isIdeasView(chosen) ? chosen : "brief";
    if (data.view && !isIdeasView(data.view)) throw notFound();
    const view: IdeasView = isIdeasView(data.view) ? data.view : defaultView;
    const tasks = await listTasks();
    const config = await loadTask(TASK).then((t) => t.config, () => ({}) as TaskConfig);
    const names = categoriesOf(config);
    const stats = problemStats(TASK);
    const muted = listMutes(TASK);
    const isMuted = (p: ProblemRow) => muted.some((m) => mentions(`${p.name}\n${p.summary}`, m));
    const verdicts = latestVerdicts();
    const problems = listProblems(TASK);
    const counted: Row[] = problems.flatMap((p) => (stats.has(p.id) ? [{ p, s: stats.get(p.id)!, v: verdicts.get(p.id) }] : []));
    const unmuted = counted.filter(({ p }) => !isMuted(p));
    const latest = latestOverview(TASK);
    const categoryName = data.category ? names.find((n) => slug(n) === data.category) : undefined;
    if (data.category && !categoryName) throw notFound();
    const rows = categoryName ? unmuted.filter((r) => r.p.category === categoryName) : unmuted;
    const o = categoryName ? latest?.categories.find((c) => c.category === categoryName) : undefined;
    const JUDGE = judgeOf(TASK);
    const judges = tasks.includes(JUDGE);
    const researches = tasks.includes(researchOf(TASK));
    // Research counts only when it was made at the problem's current verdict: one made before the judge
    // changed its mind is out of date (the research run takes a Worth testing or Watch problem again; a
    // Pass only when the reader asks).
    const research = new Map([...latestResearch()].filter(([id, r]) => r.verdict === (verdicts.get(id)?.verdict ?? "none")));
    const toItem = ({ p, s, v }: Row) => item(p, s, v);

    // The lead: a problem the research found worth competing on, the only best bet; else the best judged
    // problem the research has not taken yet, Worth testing first; else the best judged it found not
    // worth competing on; else the problem most people raised.
    const byId = new Map(rows.map((r) => [r.p.id, r]));
    const worthIt = (r: Row) => !!research.get(r.p.id)?.worth;
    const researchRank = (r: Row) => (worthIt(r) ? 0 : research.has(r.p.id) ? 2 : 1);
    const verdictRank = (r: Row) => (r.v?.verdict === "worth" ? 0 : 1);
    const judgedTop = rows
      .filter((r) => live(r) && (SHOWS.top.has(r) || worthIt(r)))
      .sort((a, b) => researchRank(a) - researchRank(b) || verdictRank(a) - verdictRank(b) || byFit(a, b))[0];
    const mostRaised = rows.filter((r) => live(r) && onBoard(r)).sort(byPeople)[0];
    const lead: { why: BestBet["why"]; row: Row } | undefined = judgedTop
      ? { why: worthIt(judgedTop) ? "researched" : research.has(judgedTop.p.id) ? "rejected" : "judged", row: judgedTop }
      : mostRaised && { why: "people", row: mostRaised };
    const leadResearch = lead && research.get(lead.row.p.id);
    const best: BestBet | null = lead ? { why: lead.why, research: leadResearch ? researchView(leadResearch) : null, problem: toItem(lead.row), quotes: quotesOf(lead.row.p.id) } : null;

    // The sentence on top, from the counts.
    const worth = rows.filter((r) => live(r) && r.v?.verdict === "worth").length;
    const watch = rows.filter((r) => live(r) && r.v?.verdict === "watch").length;
    const leadName = lead ? (leadResearch?.better?.name ?? lead.row.p.name) : "";
    const where = categoryName ? ` in ${categoryName}` : "";
    // Only a researched solution is a best bet: the rest of the leads say what they are.
    const headline = !lead
      ? `Nothing raised by more than one person${where} yet.`
      : lead.why === "researched"
      ? `Worth building${where}, the research says: ${leadName}.`
      : lead.why === "rejected"
      ? `The research found nothing worth competing on${where} yet. Closest: ${leadName}.`
      : lead.why === "judged"
      ? researches
        ? `No researched build${where} yet. Next to research: ${leadName}.`
        : worth
        ? `${plural(worth, "problem")} worth testing${where}. Start with: ${leadName}.`
        : `No clear build${where} yet. Closest: ${leadName}.`
      : rows.some((r) => r.v)
      ? `Everything judged${where} so far is a Pass. Raised most: ${leadName}.`
      : `No verdicts${where} yet${judges ? "" : ": this radar only collects and counts"}. Raised most: ${leadName}.`;
    const crowded = rows.filter((r) => live(r) && looked(r) && (r.v!.scores.gap?.score ?? 5) <= 2).length;
    const looking = worth + watch;
    const sub = !crowded
      ? null
      : crowded === looking
      ? `${looking === 1 ? "The one problem" : `All ${looking} problems`} worth a look ${looking === 1 ? "has" : "have"} little room left: tools already do it.`
      : `${crowded} of the ${looking} problems worth a look ${crowded === 1 ? "has" : "have"} little room left: tools already do it.`;

    const totals = radarTotals(TASK);
    const whole = unmuted.filter(live);
    const fresh = rows.filter((r) => live(r) && !r.v && r.p.status !== "starred" && r.s.trend === "new").sort(byPeople);
    const max = judges ? ((await loadTask(JUDGE).then((t) => t.config.judge as { maxProblems?: number } | undefined, () => undefined))?.maxProblems ?? 5) : 0;
    const tonight = judges ? toJudge(TASK, max, muted).filter(({ p }) => !categoryName || p.category === categoryName) : [];
    const queued = new Set(tonight.map(({ p }) => p.id));
    const notLead = (id: number) => id !== lead?.row.p.id;
    const lastSort = listRuns(TASK).find((r) => r.status === "ok" && r.costUsd !== undefined);
    const radarParam = all[0] && TASK !== all[0].task ? TASK : undefined;
    const page: IdeasPage = {
      nav: sidebar,
      radar: TASK,
      radars: all.length > 1 ? all : [],
      muted: counted.length - unmuted.length,
      overview: await overviewState(TASK, latest),
      view,
      defaultView,
      query: { radar: radarParam, category: data.category, view: view === defaultView ? undefined : view },
      judges,
      researches,
      categories: names
        .map((n) => ({ slug: slug(n), name: n, count: unmuted.filter((r) => r.p.category === n && live(r) && onBoard(r)).length }))
        .filter((c) => c.name === categoryName || unmuted.some((r) => r.p.category === c.name)),
      category: categoryName ? { slug: slug(categoryName), name: categoryName, take: o?.take || null } : null,
      summary: (categoryName ? o?.summary : latest?.summary) || null,
      headline,
      sub,
      funnel: {
        collected: totals.collected,
        kept: totals.posts,
        problems: whole.length,
        multi: whole.filter((r) => r.s.people > 1).length,
        judged: whole.filter((r) => r.v).length,
        worth: whole.filter((r) => r.v?.verdict === "worth").length,
        watch: whole.filter((r) => r.v?.verdict === "watch").length,
        pass: whole.filter((r) => r.v?.verdict === "pass").length,
        researched: whole.filter((r) => research.has(r.p.id)).length,
        better: whole.filter((r) => research.get(r.p.id)?.better).length,
      },
      best,
      fresh: fresh.filter((r) => !queued.has(r.p.id) && notLead(r.p.id)).map(toItem),
      tonight: tonight.filter(({ p }) => notLead(p.id)).map(({ p, s, last }) => item(p, s, last)),
      totals: { posts: totals.posts, sorted: totals.sorted, problems: totals.problems, waiting: totals.posts - totals.sorted },
      lastSort: lastSort && ago(lastSort.finishedAt ?? lastSort.startedAt),
      sources: await taskSources(TASK, config),
    };

    if (view === "brief") {
      const asked = data.show ? (LEGACY_SHOWS[data.show] ?? data.show) : undefined;
      if (asked && !(asked in SHOWS)) throw notFound();
      // The best bet is shown above the list, so no set counts it.
      const inSet = (k: Show) => rows.filter((r) => SHOWS[k].has(r) && r.p.id !== lead?.row.p.id);
      const show = (asked as Show | undefined) ?? (inSet("top").length ? "top" : "unjudged");
      const list = inSet(show).sort(SHOWS[show].order);
      page.brief = {
        show,
        shows: (Object.keys(SHOWS) as Show[]).map((k) => ({ show: k, label: SHOWS[k].label, count: inSet(k).length })),
        list: list.map(toItem),
        leadIn: !!lead && SHOWS[show].has(lead.row),
      };
    } else if (view === "map") {
      const judged = rows.filter((r) => live(r) && r.v);
      const dots = judged.filter((r) => data.passed || looked(r) || r.p.status === "starred");
      const chosen = dots.find((r) => r.p.id === data.selected)?.p.id;
      page.map = {
        dots: dots.sort(byFit).map(toItem),
        passed: judged.length - judged.filter((r) => looked(r) || r.p.status === "starred").length,
        withPassed: !!data.passed,
        selected: chosen ?? (best && dots.some((r) => r.p.id === best.problem.id) ? best.problem.id : (dots[0]?.p.id ?? null)),
      };
    } else {
      // A problem sits in one column only, the furthest stage it has reached: Testing (starred), then Worth
      // a look, then Judged next (the judge also takes judged problems again), then New or Raised most.
      const CAP = 8;
      const column = (key: string, label: string, hint: string, list: Row[], more?: Show): BoardColumn => ({ key, label, hint, items: list.slice(0, CAP).map(toItem), total: list.length, more });
      const starred = (r: Row) => r.p.status === "starred";
      const testing = rows.filter(SHOWS.starred.has).sort(byFit);
      const watching = rows.filter((r) => SHOWS.top.has(r) && !starred(r)).sort(byFit);
      const next = tonight.map(({ p }) => byId.get(p.id)).filter((r): r is Row => !!r && !starred(r) && !looked(r));
      const newOnes = fresh.filter((r) => !queued.has(r.p.id));
      const unjudged = rows.filter((r) => SHOWS.unjudged.has(r) && !starred(r));
      const columns = [
        column("new", "New this week", "First raised in the last 7 days", newOnes, "unjudged"),
        judges
          ? column("tonight", "Judged next", "The next judge run takes these", next)
          : column("raised", "Raised most", "Not judged: this radar has no judge yet", unjudged.filter((r) => r.s.trend !== "new").sort(byPeople), "unjudged"),
        column("watch", "Worth a look", "Judged Worth testing or Watch", watching, "top"),
        column("testing", "Testing", "Starred: what you are trying", testing, "starred"),
      ];
      const passed = rows.filter((r) => (SHOWS.pass.has(r) || SHOWS.killed.has(r)) && !starred(r)).sort(byPeople);
      page.board = {
        // The posts are the radar's: a post has no category until the sort gives it a problem.
        week: { problems: fresh.length, verdicts: rows.filter(recentlyJudged).length, posts: categoryName ? null : totals.recent },
        columns,
        passed: { items: passed.slice(0, 5).map(toItem), total: passed.length },
        // Without a judge every unjudged problem is in Raised most already.
        unjudged: judges ? unjudged.filter((r) => !queued.has(r.p.id) && !newOnes.includes(r)).length : 0,
      };
    }
    return page;
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
    const RESEARCH = researchOf(problem.task);
    const tasks = await listTasks();
    const tabs = await radars();
    const researched = latestResearch().get(problem.id);
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
      canJudge: tasks.includes(JUDGE),
      research: researched ? researchView(researched, latest?.verdict ?? "none") : null,
      researchAsked: !!problem.researchAsked,
      researching: !!problem.researchAsked && (isRunning(RESEARCH) || isWaiting(RESEARCH)),
      canResearch: tasks.includes(RESEARCH),
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
