import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { firstJobSeen, jobsSince, openJobs, type JobRow } from "#src/db.ts";
import { listRuns } from "#src/runner.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect the adverts (tasks/jobs-collect).
const TASK = "jobs-collect";
const WEEKS = 8;
const LIMIT = 150;

// The reader works mostly on the frontend and is open to the rest: the list puts frontend roles first,
// then the roles closest to it, and the families the title cannot tell ("Software Engineer") in the middle.
export const FAMILIES = ["frontend", "fullstack", "mobile", "general", "backend", "data", "devops"] as const;
export type Family = (typeof FAMILIES)[number];
const FAMILY_LABEL: Record<Family, string> = {
  frontend: "Frontend",
  fullstack: "Full stack",
  mobile: "Mobile",
  general: "Not in the title",
  backend: "Backend",
  data: "Data and AI",
  devops: "Platform and DevOps",
};
export type Sponsor = "yes" | "no";
export type Mode = "remote" | "hybrid" | "office";

export type JobItem = {
  id: string;
  title: string;
  company: string;
  url: string;
  location: string;
  family: string;
  /** yes: the advert says it sponsors, or the company holds a sponsor licence and the advert does not say no. */
  sponsor: Sponsor | null;
  sponsorNote: string;
  work: string | null;
  pay: string | null;
  source: string;
  seen: string;
  isNew: boolean;
};
export type FamilyRow = { family: Family; label: string; open: number; sponsors: number; remote: number; median: string | null };
export type WeekRow = { label: string; added: number; sponsors: number; remote: number; frontend: number; first: boolean };
export type JobsPage = {
  nav: Nav;
  family?: Family;
  sponsor?: Sponsor;
  mode?: Mode;
  pay: boolean;
  all: boolean;
  open: number;
  shown: number;
  jobs: JobItem[];
  families: FamilyRow[];
  weeks: WeekRow[];
  totals: { sponsors: number; says: number; no: number; remote: number; hybrid: number; office: number; median: string | null; withPay: number };
  sources: { source: string; count: number }[];
  lastRun?: string;
};

// Adverts are other people's text: behind the admin cookie like the newsletters and ideas.
function gate(next: string) {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next, failed: undefined } });
  setResponseHeader("cache-control", "private, no-store");
}

function sponsorOf(j: JobRow): Sponsor | null {
  if (j.sponsorship === "not offered" || j.sponsorship === "right to work") return "no";
  if (j.sponsorship === "offered" || j.sponsor) return "yes";
  return null;
}

function sponsorNote(j: JobRow): string {
  if (j.sponsorship === "not offered") return "Advert says no sponsorship";
  if (j.sponsorship === "right to work") return "Asks for the right to work";
  if (j.sponsorship === "offered") return j.sponsor ? `Advert says it sponsors · licensed as ${j.sponsor}` : "Advert says it sponsors";
  if (j.sponsor) return `Licensed sponsor as ${j.sponsor}`;
  return j.sponsorship === "mentioned" ? "Mentions visas, unclear" : "";
}

const familyOf = (j: JobRow) => (FAMILIES.includes(j.family as Family) ? (j.family as Family) : "general");
const modeOf = (j: JobRow) => j.workMode as Mode | null;

// The employer's own yearly pay in pounds: the middle of the range, Adzuna's estimates left out.
const yearlyGbp = (j: JobRow) =>
  j.currency === "GBP" && j.salaryPeriod === "year" && !j.salaryPredicted && j.salaryMin ? ((j.salaryMin + (j.salaryMax ?? j.salaryMin)) / 2) : null;

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return `£${Math.round(m / 1000)}k`;
}

const SYMBOL: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };
const PER: Record<string, string> = { day: "a day", hour: "an hour", week: "a week", month: "a month" };
function pay(j: JobRow): string | null {
  if (!j.salaryMin) return null;
  const sym = SYMBOL[j.currency ?? ""] ?? `${j.currency ?? ""} `;
  const amount = (n: number) => (j.salaryPeriod === "year" && n >= 10_000 ? `${sym}${Math.round(n / 1000)}k` : `${sym}${Math.round(n).toLocaleString("en-GB")}`);
  const range = j.salaryMax && j.salaryMax !== j.salaryMin ? `${amount(j.salaryMin)}–${amount(j.salaryMax)}` : amount(j.salaryMin);
  return `${range}${j.salaryPeriod && PER[j.salaryPeriod] ? ` ${PER[j.salaryPeriod]}` : ""}${j.salaryPredicted ? " (estimate)" : ""}`;
}

function work(j: JobRow): string | null {
  if (j.workMode === "remote") return "Remote";
  if (j.workMode === "hybrid") return j.officeDays ? `Hybrid, ${j.officeDays} ${j.officeDays === 1 ? "day" : "days"} in office` : "Hybrid";
  if (j.workMode === "office") return "Office";
  return j.officeDays ? `${j.officeDays} days in office` : null;
}

const SOURCE: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", hn: "HN Who is hiring", himalayas: "Himalayas", adzuna: "Adzuna", reed: "Reed" };

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

// Monday 00:00 UTC of the week a time falls in.
function weekStart(t: number) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

// The open adverts, frontend first, filtered by the chips; the families and the last 8 weeks counted
// over all of them, so the chips and the table do not change with the filters.
export const getJobsPage = createServerFn({ method: "GET" })
  .validator((data: { family?: string; sponsor?: string; mode?: string; pay?: boolean; all?: boolean }) => data)
  .handler(async ({ data }): Promise<JobsPage> => {
    gate("/jobs");
    const { configs: _, ...sidebar } = await nav();
    const family = data.family && FAMILIES.includes(data.family as Family) ? (data.family as Family) : undefined;
    const sponsor = data.sponsor === "yes" || data.sponsor === "no" ? (data.sponsor as Sponsor) : undefined;
    const mode = data.mode === "remote" || data.mode === "hybrid" || data.mode === "office" ? (data.mode as Mode) : undefined;
    if ((data.family && !family) || (data.sponsor && !sponsor) || (data.mode && !mode)) throw notFound();

    const open = openJobs();
    const now = Date.now();
    const rank = (j: JobRow) => FAMILIES.indexOf(familyOf(j));
    const sponsorRank = (j: JobRow) => ({ yes: 0, null: 1, no: 2 })[String(sponsorOf(j)) as "yes" | "null" | "no"];
    const matching = open
      .filter((j) => (!family || familyOf(j) === family) && (!sponsor || sponsorOf(j) === sponsor) && (!mode || modeOf(j) === mode) && (!data.pay || j.salaryMin))
      .sort((a, b) => rank(a) - rank(b) || sponsorRank(a) - sponsorRank(b) || b.firstSeen.localeCompare(a.firstSeen));
    const shown = data.all ? matching : matching.slice(0, LIMIT);

    const families: FamilyRow[] = FAMILIES.map((f) => {
      const of = open.filter((j) => familyOf(j) === f);
      return {
        family: f,
        label: FAMILY_LABEL[f],
        open: of.length,
        sponsors: pct(of.filter((j) => sponsorOf(j) === "yes").length, of.length),
        remote: pct(of.filter((j) => j.workMode === "remote").length, of.length),
        median: median(of.flatMap((j) => yearlyGbp(j) ?? [])),
      };
    });

    // New adverts per week by when they were first seen. The week collection started holds everything
    // that was open that day, so it is marked rather than read as a jump.
    const thisWeek = weekStart(now);
    const from = thisWeek - (WEEKS - 1) * 7 * 86_400_000;
    const started = firstJobSeen();
    const startWeek = started ? weekStart(Date.parse(started)) : null;
    const recent = jobsSince(new Date(from).toISOString());
    // Only the weeks since collection started.
    const starts = Array.from({ length: WEEKS }, (_, i) => from + i * 7 * 86_400_000).filter((start) => startWeek !== null && start >= startWeek);
    const weeks: WeekRow[] = starts.map((start) => {
      const of = recent.filter((j) => weekStart(Date.parse(j.firstSeen)) === start);
      return {
        label: formatDay(new Date(start).toISOString(), "Europe/London"),
        added: of.length,
        sponsors: pct(of.filter((j) => sponsorOf(j) === "yes").length, of.length),
        remote: pct(of.filter((j) => j.workMode === "remote").length, of.length),
        frontend: pct(of.filter((j) => ["frontend", "fullstack", "mobile"].includes(familyOf(j))).length, of.length),
        first: start === startWeek,
      };
    });

    const lastRun = listRuns(TASK).find((r) => r.status === "ok");
    const bySource = new Map<string, number>();
    for (const j of open) bySource.set(j.source, (bySource.get(j.source) ?? 0) + 1);
    return {
      nav: sidebar,
      family,
      sponsor,
      mode,
      pay: !!data.pay,
      all: !!data.all,
      open: open.length,
      shown: matching.length,
      jobs: shown.map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        url: j.url,
        location: j.location.length > 80 ? `${j.location.slice(0, 80)}…` : j.location,
        family: FAMILY_LABEL[familyOf(j)],
        sponsor: sponsorOf(j),
        sponsorNote: sponsorNote(j),
        work: work(j),
        pay: pay(j),
        source: SOURCE[j.source] ?? j.source,
        seen: formatDay(j.firstSeen, "Europe/London"),
        isNew: now - Date.parse(j.firstSeen) < 3 * 86_400_000 && (!started || Date.parse(j.firstSeen) - Date.parse(started) > 86_400_000),
      })),
      families,
      weeks,
      totals: {
        sponsors: pct(open.filter((j) => sponsorOf(j) === "yes").length, open.length),
        says: open.filter((j) => j.sponsorship === "offered").length,
        no: open.filter((j) => sponsorOf(j) === "no").length,
        remote: pct(open.filter((j) => j.workMode === "remote").length, open.length),
        hybrid: pct(open.filter((j) => j.workMode === "hybrid").length, open.length),
        office: pct(open.filter((j) => j.workMode === "office").length, open.length),
        median: median(open.flatMap((j) => yearlyGbp(j) ?? [])),
        withPay: open.filter((j) => j.salaryMin).length,
      },
      sources: [...bySource].map(([source, count]) => ({ source: SOURCE[source] ?? source, count })).sort((a, b) => b.count - a.count),
      lastRun: lastRun && ago(lastRun.finishedAt ?? lastRun.startedAt),
    };
  });
