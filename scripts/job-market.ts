// Writes market.md for the weekly job market paper (tasks/jobs-weekly): the facts of the week, counted by
// code from the jobs table (../../pergent.db, opened read-only) that jobs-collect fills and jobs-read
// reads, so the model only writes them up. This week is the last 7 days by first_seen, the week before
// the 7 days before that; an advert is open when the newest collection or one within 36 hours of it saw
// it. Then a shortlist of open adverts at employers that sponsor, new this week, that jobs-read judged a
// fit of 3 or more for the reader, the best fit first, then those matching the reader's stack (under
// "market.stack" in task.json). Pay is also given as what it is worth in the reader's home area after
// tax and rent (src/pay.ts).
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JOB_COLUMNS, toJobRow, type JobDbRow, type JobRow } from "../src/db.ts";
import { FAMILIES, FAMILY_LABEL, FRONT_SIDE, familyOf, median, notDeveloper, sponsorNote, sponsorOf, sponsorWords, yearlyGbp } from "../src/jobs.ts";
import { HOME, RENTS_MONTH, worthAtHome } from "../src/pay.ts";

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const market = (config.market ?? {}) as { stack?: string[]; shortlist?: number; skills?: number };
const stack = (market.stack ?? []).map((s) => s.toLowerCase());

const db = new DatabaseSync(join("..", "..", "pergent.db"), { readOnly: true });
const all = (db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs`).all() as unknown as JobDbRow[]).map(toJobRow).filter((j) => !notDeveloper(j));
db.close();

const DAY = 86_400_000;
const now = Date.now();
const newest = Math.max(0, ...all.map((j) => Date.parse(j.lastSeen)));
const isOpen = (j: JobRow) => Date.parse(j.lastSeen) >= newest - 1.5 * DAY;
const firstSeen = Math.min(...all.map((j) => Date.parse(j.firstSeen)));
const open = all.filter(isOpen);
const thisWeek = all.filter((j) => Date.parse(j.firstSeen) >= now - 7 * DAY);
const lastWeek = all.filter((j) => Date.parse(j.firstSeen) >= now - 14 * DAY && Date.parse(j.firstSeen) < now - 7 * DAY);
const closed = all.filter((j) => !isOpen(j) && Date.parse(j.lastSeen) >= now - 7 * DAY - 1.5 * DAY);
const firstWeek = firstSeen >= now - 7 * DAY;
const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "n/a");
const count = (jobs: JobRow[], test: (j: JobRow) => boolean) => jobs.filter(test).length;
const lines: string[] = [];
const out = (...l: string[]) => lines.push(...l);

out(`# The job market, week to ${day(now)}`, "");
out(
  `UK software developer adverts (in the UK or remote from it, no managers), from employers' own job boards (Greenhouse, Lever, Ashby), HN "Who is hiring?", Himalayas, Adzuna and Reed. Counted by code; the role, skills and visa wording of each advert were read from its text by a model.`,
  "",
);
if (firstWeek)
  out(
    `Collection started on ${day(firstSeen)}, so this is the first week: "new this week" is every advert open since then, and there is no earlier week to compare with. Say so, and treat these numbers as the baseline later weeks are compared with.`,
    "",
  );

out("## Volume", "");
out(`- Open now: ${open.length}`);
out(`- New this week: ${thisWeek.length}${firstWeek ? "" : `; the week before: ${lastWeek.length}`}`);
if (!firstWeek) out(`- Closed this week (no longer listed): ${closed.length}`);
out(`- Read by the model: ${count(open, (j) => !!j.read)} of the ${open.length} open`, "");

const families = FAMILIES.filter((f) => f !== "general" || count(open, (j) => familyOf(j) === f) > 0);
out("## Open adverts by role", "", "| Role | Open | New this week | Week before | At sponsors | Remote | Median pay (£/year, employer's figure) |", "|---|---|---|---|---|---|---|");
for (const f of families) {
  const of = open.filter((j) => familyOf(j) === f);
  out(
    `| ${FAMILY_LABEL[f]} | ${of.length} | ${count(thisWeek, (j) => familyOf(j) === f)} | ${firstWeek ? "n/a" : count(lastWeek, (j) => familyOf(j) === f)} | ${pct(count(of, (j) => sponsorOf(j) === "yes"), of.length)} | ${pct(count(of, (j) => j.workMode === "remote"), of.length)} | ${median(of.flatMap((j) => yearlyGbp(j) ?? [])) ?? "too few"} (${count(of, (j) => yearlyGbp(j) !== null)} with pay) |`,
  );
}
out("", `"Not read yet" are adverts whose title names no role and that the model has not read yet.`, "");

const front = open.filter((j) => FRONT_SIDE.includes(familyOf(j)));
const worth = (j: JobRow) => {
  const gross = yearlyGbp(j);
  return gross === null ? null : worthAtHome(gross, j.location, j.workMode === "remote");
};

out(`## Pay by place, and what it is worth in ${HOME} (open adverts with the employer's yearly pay in pounds)`, "");
out(
  `"Worth in ${HOME}" is the salary that would leave as much in ${HOME}, where the reader lives, after 2026/27 income tax and National Insurance (Scottish rates for Scotland) and the average one-bed rent of each place (ONS, ${RENTS_MONTH}). Remote jobs are taken as done from ${HOME}. Pension, student loan and other prices are left out.`,
  "",
  `| Place | Adverts with pay | Median pay | Median worth in ${HOME} | One-bed rent a month |`,
  "|---|---|---|---|---|",
);
const byPlace = new Map<string, { pay: number[]; home: number[]; rent: number }>();
for (const j of open) {
  const w = worth(j);
  if (!w) continue;
  const key = w.place === HOME && j.workMode === "remote" ? "Remote" : w.place;
  const row = byPlace.get(key) ?? { pay: [], home: [], rent: w.rent };
  row.pay.push(yearlyGbp(j)!);
  row.home.push(w.atHome);
  byPlace.set(key, row);
}
for (const [place, r] of [...byPlace].sort((a, b) => b[1].pay.length - a[1].pay.length).slice(0, 12))
  out(`| ${place} | ${r.pay.length} | ${median(r.pay)} | ${median(r.home)} | £${r.rent} |`);
out("");
out("## Sponsorship (open adverts)", "");
out(`- At an employer on the Home Office register of licensed sponsors, and the advert does not say no: ${pct(count(open, (j) => sponsorOf(j) === "yes"), open.length)} of all, ${pct(count(front, (j) => sponsorOf(j) === "yes"), front.length)} on the frontend side (frontend, full stack, mobile: ${front.length} open)`);
out(`- The advert itself says it sponsors visas: ${count(open, (j) => sponsorWords(j) === "offered")}`);
out(`- The advert says it cannot sponsor: ${count(open, (j) => sponsorWords(j) === "not offered")}; asks for the existing right to work: ${count(open, (j) => sponsorWords(j) === "right to work")}`, "");

out("## Work mode (open adverts)", "");
for (const [label, jobs] of [["All", open], ["Frontend side", front]] as const)
  out(`- ${label}: remote ${pct(count(jobs, (j) => j.workMode === "remote"), jobs.length)}, hybrid ${pct(count(jobs, (j) => j.workMode === "hybrid"), jobs.length)}, office ${pct(count(jobs, (j) => j.workMode === "office"), jobs.length)}, not said ${pct(count(jobs, (j) => !j.workMode), jobs.length)}`);
const days = front.flatMap((j) => j.officeDays ?? []);
if (days.length) out(`- Frontend side hybrid adverts that name office days: ${days.length}, median ${[...days].sort((a, b) => a - b)[Math.floor(days.length / 2)]} days a week`);
out("");

// Skills: the share of read adverts asking for each, open now and among the new adverts of each week.
const skillShare = (jobs: JobRow[]) => {
  const read = jobs.filter((j) => j.read);
  const counts = new Map<string, { name: string; n: number }>();
  for (const j of read) for (const s of j.read!.skills) counts.set(s.toLowerCase(), { name: s, n: (counts.get(s.toLowerCase())?.n ?? 0) + 1 });
  return { read: read.length, counts };
};
const top = market.skills ?? 20;
for (const [label, jobs, prevJobs] of [
  ["All roles", open, lastWeek],
  ["Frontend side", front, lastWeek.filter((j) => FRONT_SIDE.includes(familyOf(j)))],
] as const) {
  const nowShare = skillShare(jobs);
  const newShare = skillShare(label === "All roles" ? thisWeek : thisWeek.filter((j) => FRONT_SIDE.includes(familyOf(j))));
  const prevShare = skillShare(prevJobs);
  const compare = !firstWeek && prevShare.read >= 15;
  out(`## Most asked-for skills, ${label.toLowerCase()} (${nowShare.read} open adverts read)`, "");
  out(`| Skill | Open adverts asking | Share of open | Share of new this week | ${compare ? "Share of new the week before |" : ""}`, `|---|---|---|---|${compare ? "---|" : ""}`);
  for (const { name, n } of [...nowShare.counts.values()].sort((a, b) => b.n - a.n).slice(0, top)) {
    const k = name.toLowerCase();
    out(`| ${name} | ${n} | ${pct(n, nowShare.read)} | ${pct(newShare.counts.get(k)?.n ?? 0, newShare.read)} | ${compare ? `${pct(prevShare.counts.get(k)?.n ?? 0, prevShare.read)} |` : ""}`);
  }
  if (!compare && !firstWeek) out("", `Too few read adverts the week before (${prevShare.read}) to compare.`);
  out("");
}

const ai = (jobs: JobRow[]) => pct(count(jobs, (j) => !!j.read?.aiTools), count(jobs, (j) => !!j.read));
out("## AI coding tools", "", `- Read adverts that expect AI coding tools (Copilot, Cursor, Claude Code, agents) in the daily work: ${ai(open)} of open, ${ai(front)} on the frontend side${firstWeek ? "" : `; ${ai(thisWeek)} of this week's new against ${ai(lastWeek)} the week before`}`);
const years = front.flatMap((j) => (j.read?.minYears ? [j.read.minYears] : [])).sort((a, b) => a - b);
if (years.length) out(`- Frontend side adverts naming the years of experience: ${years.length}, median ${years[Math.floor(years.length / 2)]}+ years`);
out("");

// The shortlist: sponsors, new this week, a fit of 3 or more; the best fit first, then stack matches,
// then frontend before full stack before mobile before the rest, then newest.
const fit = (j: JobRow) => [...(j.read?.skills ?? []), ...(j.read?.niceSkills ?? [])].filter((s) => stack.includes(s.toLowerCase()));
const side = (j: JobRow) => (FRONT_SIDE.includes(familyOf(j)) ? FRONT_SIDE.indexOf(familyOf(j)) : FRONT_SIDE.length);
const picks = open
  .filter((j) => sponsorOf(j) === "yes" && thisWeek.includes(j) && (j.read?.fit ?? 0) >= 3)
  .sort((a, b) => b.read!.fit! - a.read!.fit! || fit(b).length - fit(a).length || side(a) - side(b) || b.firstSeen.localeCompare(a.firstSeen))
  .slice(0, market.shortlist ?? 25);
out(`## Shortlist: open adverts at employers that sponsor, new this week, judged a fit for the reader (${picks.length})`, "");
out(`The fit (1 to 5) was judged by a model against the reader's profile. Ordered by fit, then by how much of the reader's stack (${(market.stack ?? []).join(", ")}) they ask for.`, "");
for (const j of picks) {
  const pay = yearlyGbp(j) ? `£${Math.round(j.salaryMin! / 1000)}k${j.salaryMax && j.salaryMax !== j.salaryMin ? `–${Math.round(j.salaryMax / 1000)}k` : ""}` : "pay not given";
  out(
    `### ${j.title} at ${j.company}`,
    `- ${j.url}`,
    `- ${FAMILY_LABEL[familyOf(j)]} · ${j.location || "no location"} · ${j.workMode ?? "work mode not said"}${j.officeDays ? `, ${j.officeDays} days in office` : ""} · ${pay}${j.read?.minYears ? ` · ${j.read.minYears}+ years` : ""}`,
    `- Skills: ${j.read?.skills.join(", ") || "not read"}${j.read?.niceSkills.length ? `; a plus: ${j.read.niceSkills.join(", ")}` : ""}`,
    `- Fit for the reader: ${j.read!.fit}/5, ${j.read!.fitWhy}`,
    `- Matches the reader's stack: ${fit(j).join(", ") || "none named"}`,
    ...(worth(j) && worth(j)!.place !== HOME ? [`- Worth in ${HOME}: £${Math.round(worth(j)!.atHome / 1000)}k (after tax and a one-bed rent of £${worth(j)!.rent} in ${worth(j)!.place})`] : []),
    `- Sponsorship: ${sponsorNote(j)}`,
    "",
  );
}
await writeFile("market.md", lines.join("\n") + "\n");
console.log(`market.md: ${open.length} open, ${thisWeek.length} new this week, ${picks.length} on the shortlist`);
