import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { firstJobSeen, jobsSince, openJobs, type JobRow } from "#src/db.ts";
import { FAMILIES, FAMILY_LABEL, FRONT_SIDE, familyOf, hasSkill, median, notDeveloper, sponsorNote, sponsorOf, sponsorWords as words, yearlyGbp, type Family, type Sponsor } from "#src/jobs.ts";
import { HOME, RENTS_MONTH, worthAtHome } from "#src/pay.ts";
import { listRuns } from "#src/runner.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect the adverts (tasks/jobs-collect).
const TASK = "jobs-collect";
const WEEKS = 8;
const LIMIT = 150;
const SKILLS = 20;
export type { Family, Sponsor };

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
  skills: string[];
  years: string | null;
  /** What the pay is worth at home after tax and rent where the job is, like "£59k in Nottingham". */
  worth: string | null;
  worthNote: string;
  fit: number | null;
  fitWhy: string;
  source: string;
  seen: string;
  isNew: boolean;
};
export type FamilyRow = { family: Family; label: string; open: number; sponsors: number; remote: number; median: string | null; atHome: string | null; good: number };
export type PlaceRow = { place: string; withPay: number; median: string | null; atHome: string | null; rent: string };
export type SkillRow = { skill: string; adverts: number; share: number; frontSide: number };
export type WeekRow = { label: string; added: number; sponsors: number; remote: number; frontend: number; first: boolean };
export type JobsPage = {
  nav: Nav;
  family?: Family;
  sponsor?: Sponsor;
  mode?: Mode;
  skill?: string;
  fit: boolean;
  pay: boolean;
  all: boolean;
  open: number;
  shown: number;
  jobs: JobItem[];
  families: FamilyRow[];
  skills: SkillRow[];
  places: PlaceRow[];
  home: string;
  rentsMonth: string;
  weeks: WeekRow[];
  totals: {
    sponsors: number;
    says: number;
    no: number;
    remote: number;
    hybrid: number;
    office: number;
    median: string | null;
    withPay: number;
    read: number;
    aiTools: number;
    notDev: number;
    good: number;
  };
  sources: { source: string; count: number }[];
  lastRun?: string;
};

// Adverts are other people's text: behind the admin cookie like the newsletters and ideas.
function gate(next: string) {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next, failed: undefined } });
  setResponseHeader("cache-control", "private, no-store");
}

const modeOf = (j: JobRow) => j.workMode as Mode | null;

// A fit of 4 or 5 out of 5 is a good one.
const GOOD_FIT = 4;

// What the employer's yearly pay in pounds is worth at home (src/pay.ts), the middle of its range.
const worthOf = (j: JobRow) => {
  const gross = yearlyGbp(j);
  return gross === null ? null : worthAtHome(gross, j.location, j.workMode === "remote");
};
function worthText(j: JobRow): { worth: string | null; worthNote: string } {
  const w = worthOf(j);
  if (!w) return { worth: null, worthNote: "" };
  const month = `£${w.leftMonthly.toLocaleString("en-GB")} a month after tax, National Insurance and the average one-bed rent`;
  if (w.place === HOME) return { worth: null, worthNote: `${month} in ${HOME} (£${w.rent.toLocaleString("en-GB")})` };
  return {
    worth: `worth £${Math.round(w.atHome / 1000)}k in ${HOME}`,
    worthNote: `${month} in ${w.place} (£${w.rent.toLocaleString("en-GB")}${w.area !== w.place ? `, ${w.area}` : ""}), which £${Math.round(w.atHome / 1000)}k leaves in ${HOME}`,
  };
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
  .validator((data: { family?: string; sponsor?: string; mode?: string; skill?: string; fit?: boolean; pay?: boolean; all?: boolean }) => data)
  .handler(async ({ data }): Promise<JobsPage> => {
    gate("/jobs");
    const { configs: _, ...sidebar } = await nav();
    const family = data.family && FAMILIES.includes(data.family as Family) ? (data.family as Family) : undefined;
    const sponsor = data.sponsor === "yes" || data.sponsor === "no" ? (data.sponsor as Sponsor) : undefined;
    const mode = data.mode === "remote" || data.mode === "hybrid" || data.mode === "office" ? (data.mode as Mode) : undefined;
    if ((data.family && !family) || (data.sponsor && !sponsor) || (data.mode && !mode)) throw notFound();

    // The model sets aside an advert that is not a developer job (a sales engineer whose title got through).
    const collected = openJobs();
    const open = collected.filter((j) => !notDeveloper(j));
    const now = Date.now();
    const rank = (j: JobRow) => FAMILIES.indexOf(familyOf(j));
    const sponsorRank = (j: JobRow) => ({ yes: 0, null: 1, no: 2 })[String(sponsorOf(j)) as "yes" | "null" | "no"];
    // The best fit for the reader first (tasks/jobs-read/profile.md), the adverts not read yet last.
    const fitRank = (j: JobRow) => -(j.read?.fit ?? 0);
    const matching = open
      .filter(
        (j) =>
          (!family || familyOf(j) === family) &&
          (!sponsor || sponsorOf(j) === sponsor) &&
          (!mode || modeOf(j) === mode) &&
          (!data.skill || hasSkill(j, data.skill)) &&
          (!data.fit || (j.read?.fit ?? 0) >= GOOD_FIT) &&
          (!data.pay || j.salaryMin),
      )
      .sort((a, b) => fitRank(a) - fitRank(b) || rank(a) - rank(b) || sponsorRank(a) - sponsorRank(b) || b.firstSeen.localeCompare(a.firstSeen));
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
        atHome: median(of.flatMap((j) => worthOf(j)?.atHome ?? [])),
        good: of.filter((j) => (j.read?.fit ?? 0) >= GOOD_FIT).length,
      };
    });

    // Pay by the place the job is, against what it is worth at home: the places with the most adverts
    // that give a salary.
    const byPlace = new Map<string, { pay: number[]; home: number[]; rent: number }>();
    for (const j of open) {
      const w = worthOf(j);
      const gross = yearlyGbp(j);
      if (!w || gross === null) continue;
      const key = w.place === HOME && j.workMode === "remote" ? "Remote" : w.place;
      const row = byPlace.get(key) ?? { pay: [], home: [], rent: w.rent };
      row.pay.push(gross);
      row.home.push(w.atHome);
      byPlace.set(key, row);
    }
    const places: PlaceRow[] = [...byPlace]
      .sort((a, b) => b[1].pay.length - a[1].pay.length)
      .slice(0, 10)
      .map(([place, r]) => ({ place, withPay: r.pay.length, median: median(r.pay), atHome: median(r.home), rent: place === "Remote" ? `${HOME}'s` : `£${r.rent.toLocaleString("en-GB")}` }));

    // The technologies the read adverts ask for, the most asked first, with how many of the frontend
    // side's read adverts ask for each.
    const read = open.filter((j) => j.read);
    const frontRead = read.filter((j) => FRONT_SIDE.includes(familyOf(j)));
    const bySkill = new Map<string, { skill: string; adverts: number; front: number }>();
    for (const j of read) {
      for (const skill of j.read!.skills) {
        const row = bySkill.get(skill.toLowerCase()) ?? { skill, adverts: 0, front: 0 };
        row.adverts++;
        if (FRONT_SIDE.includes(familyOf(j))) row.front++;
        bySkill.set(skill.toLowerCase(), row);
      }
    }
    const skills: SkillRow[] = [...bySkill.values()]
      .sort((a, b) => b.adverts - a.adverts || a.skill.localeCompare(b.skill))
      .slice(0, SKILLS)
      .map((r) => ({ skill: r.skill, adverts: r.adverts, share: pct(r.adverts, read.length), frontSide: pct(r.front, frontRead.length) }));

    // New adverts per week by when they were first seen. The week collection started holds everything
    // that was open that day, so it is marked rather than read as a jump.
    const thisWeek = weekStart(now);
    const from = thisWeek - (WEEKS - 1) * 7 * 86_400_000;
    const started = firstJobSeen();
    const startWeek = started ? weekStart(Date.parse(started)) : null;
    const recent = jobsSince(new Date(from).toISOString()).filter((j) => !notDeveloper(j));
    // Only the weeks since collection started.
    const starts = Array.from({ length: WEEKS }, (_, i) => from + i * 7 * 86_400_000).filter((start) => startWeek !== null && start >= startWeek);
    const weeks: WeekRow[] = starts.map((start) => {
      const of = recent.filter((j) => weekStart(Date.parse(j.firstSeen)) === start);
      return {
        label: formatDay(new Date(start).toISOString(), "Europe/London"),
        added: of.length,
        sponsors: pct(of.filter((j) => sponsorOf(j) === "yes").length, of.length),
        remote: pct(of.filter((j) => j.workMode === "remote").length, of.length),
        frontend: pct(of.filter((j) => FRONT_SIDE.includes(familyOf(j))).length, of.length),
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
      skill: data.skill,
      fit: !!data.fit,
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
        skills: j.read?.skills.slice(0, 6) ?? [],
        years: j.read?.minYears ? `${j.read.minYears}+ years` : null,
        ...worthText(j),
        fit: j.read?.fit ?? null,
        fitWhy: j.read?.fitWhy ?? "",
        source: SOURCE[j.source] ?? j.source,
        seen: formatDay(j.firstSeen, "Europe/London"),
        isNew: now - Date.parse(j.firstSeen) < 3 * 86_400_000 && (!started || Date.parse(j.firstSeen) - Date.parse(started) > 86_400_000),
      })),
      families,
      skills,
      places,
      home: HOME,
      rentsMonth: new Date(`${RENTS_MONTH}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      weeks,
      totals: {
        sponsors: pct(open.filter((j) => sponsorOf(j) === "yes").length, open.length),
        says: open.filter((j) => words(j) === "offered").length,
        no: open.filter((j) => sponsorOf(j) === "no").length,
        remote: pct(open.filter((j) => j.workMode === "remote").length, open.length),
        hybrid: pct(open.filter((j) => j.workMode === "hybrid").length, open.length),
        office: pct(open.filter((j) => j.workMode === "office").length, open.length),
        median: median(open.flatMap((j) => yearlyGbp(j) ?? [])),
        withPay: open.filter((j) => j.salaryMin).length,
        read: read.length,
        aiTools: pct(read.filter((j) => j.read!.aiTools).length, read.length),
        notDev: collected.length - open.length,
        good: open.filter((j) => (j.read?.fit ?? 0) >= GOOD_FIT).length,
      },
      sources: [...bySource].map(([source, count]) => ({ source: SOURCE[source] ?? source, count })).sort((a, b) => b.count - a.count),
      lastRun: lastRun && ago(lastRun.finishedAt ?? lastRun.startedAt),
    };
  });
