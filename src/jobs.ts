// The job market tracker's reading step. jobs-collect stores the adverts with what code can read from
// them (the family a title names, pay, work mode, sponsorship wording); then prepareRead writes the open
// adverts no read has seen into adverts.md, haiku says for each what the role works on and with, and
// saveReadOutput stores that on the advert. The counting stays code (app/server/jobs.functions.ts).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { companyBodies, saveJobReads, unreadJobs, type JobRead, type JobRow, type UnreadJob } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

export const TEXT_FAMILIES = ["frontend", "fullstack", "backend", "mobile", "data", "devops", "not a developer"] as const;
const SPONSORSHIP = ["offered", "not offered", "right to work", "not said"] as const;

// What code makes of an advert for the Jobs page and the weekly paper (scripts/job-market.ts).

// The reader works mostly on the frontend and is open to the rest: the list puts frontend roles first,
// then the roles closest to it, and the adverts not read yet whose title does not tell ("Software
// Engineer") in the middle.
export const FAMILIES = ["frontend", "fullstack", "mobile", "general", "backend", "data", "devops"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  frontend: "Frontend",
  fullstack: "Full stack",
  mobile: "Mobile",
  general: "Not read yet",
  backend: "Backend",
  data: "Data and AI",
  devops: "Platform and DevOps",
};
export type Sponsor = "yes" | "no";

// What the advert's words say about sponsorship: code's patterns when they read it plainly, else the
// model's reading of the text.
export function sponsorWords(j: JobRow): string | null {
  if (j.sponsorship && j.sponsorship !== "mentioned") return j.sponsorship;
  if (j.read && j.read.textSponsorship !== "not said") return j.read.textSponsorship;
  return j.sponsorship;
}

export function sponsorOf(j: JobRow): Sponsor | null {
  const w = sponsorWords(j);
  if (w === "not offered" || w === "right to work") return "no";
  if (w === "offered" || j.sponsor) return "yes";
  return null;
}

export function sponsorNote(j: JobRow): string {
  const w = sponsorWords(j);
  if (w === "not offered") return "Advert says no sponsorship";
  if (w === "right to work") return "Asks for the right to work";
  if (w === "offered") return j.sponsor ? `Advert says it sponsors · licensed as ${j.sponsor}` : "Advert says it sponsors";
  if (j.sponsor) return `Licensed sponsor as ${j.sponsor}`;
  return w === "mentioned" ? "Mentions visas, unclear" : "";
}

// The family the title names, else the one the model read from the text (prepareRead below).
export function familyOf(j: JobRow): Family {
  if (j.family !== "general" && FAMILIES.includes(j.family as Family)) return j.family as Family;
  const read = j.read?.textFamily;
  return read && FAMILIES.includes(read as Family) ? (read as Family) : "general";
}
export const FRONT_SIDE: Family[] = ["frontend", "fullstack", "mobile"];
export const notDeveloper = (j: JobRow) => j.read?.textFamily === "not a developer";
export const hasSkill = (j: JobRow, skill: string) => !!j.read && [...j.read.skills, ...j.read.niceSkills].some((s) => s.toLowerCase() === skill.toLowerCase());

// The employer's own yearly pay in pounds: the middle of the range, Adzuna's estimates left out.
export const yearlyGbp = (j: JobRow) =>
  j.currency === "GBP" && j.salaryPeriod === "year" && !j.salaryPredicted && j.salaryMin ? ((j.salaryMin + (j.salaryMax ?? j.salaryMin)) / 2) : null;

export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return `£${Math.round(m / 1000)}k`;
}


const readConfig = (config: TaskConfig) => (config.read ?? {}) as { maxChars?: number; advertChars?: number; companyChars?: number };

export function readSchema() {
  const text = (description: string) => ({ type: "string", description });
  const list = (description: string) => ({ type: "array", items: { type: "string" }, description });
  return {
    type: "object",
    required: ["adverts"],
    additionalProperties: false,
    properties: {
      adverts: {
        type: "array",
        description: "Every advert of adverts.md, once each, in any order.",
        items: {
          type: "object",
          required: ["ref", "family", "skills", "niceToHave", "minYears", "sponsorship", "aiTools", "fit", "fitWhy"],
          additionalProperties: false,
          properties: {
            ref: text("The advert's ref from adverts.md, like a12."),
            family: {
              type: "string",
              enum: TEXT_FAMILIES,
              description:
                "What the role mostly works on, from its duties and requirements: frontend (the user interface: web UI, design systems, React, Vue, Angular), fullstack (both the UI and the server in real measure, or it says full stack), backend (APIs, services, databases, no UI), mobile (iOS, Android, React Native, Flutter apps), data (data engineering, machine learning or AI engineering, data science), devops (infrastructure, platform, cloud, SRE, security engineering), or \"not a developer\" when the job is not writing software (a manager, sales, support, analyst, designer, recruiter).",
            },
            skills: list(
              "The technologies the role works with that this advert names: languages, frameworks, libraries, databases, cloud and infrastructure, tools. Common names: React, TypeScript, JavaScript, Node.js, Next.js, React Native, Python, Go, Java, Kotlin, Swift, AWS, GCP, Azure, PostgreSQL, Kubernetes, Docker, Terraform, GraphQL, LLMs. Not practices or soft skills (agile, TDD, microservices, communication). Not the ones named only as a plus. At most 15, the most central first.",
            ),
            niceToHave: list("Technologies named only as a plus, bonus, nice to have or desirable, in the same names. Not repeated from skills. At most 10."),
            minYears: { type: "integer", description: "The fewest years of experience it asks for (\"3+ years\" is 3, \"3-5 years\" is 3). 0 when it names none." },
            sponsorship: {
              type: "string",
              enum: SPONSORSHIP,
              description:
                "What this advert says about visa sponsorship: offered (it sponsors visas or helps with them), not offered (it cannot sponsor), right to work (it asks for the existing right to work in the UK without saying either), or not said.",
            },
            aiTools: { type: "boolean", description: "The advert expects or encourages using AI coding tools (Copilot, Cursor, Claude Code, coding agents) in the daily work. Building AI features is not this; that goes in skills." },
            fit: {
              type: "integer",
              description:
                "How well the reader in profile.md fits this role, 1 to 5: 5 a strong match (the role's core is what they are strongest in, at their level), 4 a good match with a gap or two they could close, 3 possible but a stretch (much of the stack or the level is new to them), 2 a poor match (the role's core is something they don't do), 1 not for them (management, research, hardware, or wholly another field). Judge the work and the level, not the visa or the place.",
            },
            fitWhy: text("Why, in at most 20 words, naming what matches and the main gap, like \"React and TypeScript product UI at their level; no Go experience\"."),
          },
        },
      },
    },
  };
}

// Lines no advert's role is in: the equal opportunity statement, benefits, privacy and fraud notices.
// A line about visas or the right to work always stays.
const BOILERPLATE =
  /equal opportunit|regardless of|irrespective of|discriminat|neurodivers|veteran|reasonable adjustment|accommodation|privacy (notice|policy)|personal data|fraudulent|falsely claim|charge any fees|pension|private medical|health (insurance|cash plan)|dental|life (assurance|insurance)|parental leave|annual leave|holiday|cycle to work|\bgym\b|wellbeing|employee assistance|we celebrate|e-?verify|our values/i;
const VISA = /visa|sponsor|right to work/i;

const linesOf = (body: string) => [...new Set(body.split("\n").map((l) => l.trim()).filter(Boolean))];

// The lines most of a company's adverts share, three at least (its about-us, its stack, its benefits):
// shown once per company instead of with every advert. Lines only some share stay with each advert,
// since a company that posts one role for several teams repeats that role's duties in each. Lines about
// visas stay with each advert too.
function sharedLines(bodies: string[]): Set<string> {
  const count = new Map<string, number>();
  for (const body of bodies) for (const l of linesOf(body)) if (l.length >= 40 && !VISA.test(l)) count.set(l, (count.get(l) ?? 0) + 1);
  const most = Math.max(3, Math.ceil(bodies.length / 2));
  return new Set([...count].filter(([, n]) => n >= most).map(([l]) => l));
}

const clip = (lines: string[], chars: number) => {
  const text = lines.join("\n");
  return text.length > chars ? `${text.slice(0, chars)}…` : text;
};

// Writes profile.md (the reader, whom each advert's fit is judged against: the task directory's own
// profile.md), adverts.md (the open adverts no read has seen, newest companies first, grouped by company with
// what all of a company's adverts say shown once, up to `read.maxChars` in all) and read.json, the refs
// saveReadOutput checks the answer against. Returns how many adverts went in and how many wait.
export async function prepareRead(dir: string, taskDir: string, config: TaskConfig): Promise<{ adverts: number; waiting: number }> {
  await writeFile(join(dir, "profile.md"), await readFile(join(taskDir, "profile.md"), "utf8"));
  const { maxChars = 150_000, advertChars = 3500, companyChars = 1500 } = readConfig(config);
  const unread = unreadJobs();
  const byCompany = new Map<string, UnreadJob[]>();
  for (const j of unread) byCompany.set(j.company, [...(byCompany.get(j.company) ?? []), j]);
  const bodies = new Map<string, string[]>();
  for (const { company, body } of companyBodies([...byCompany.keys()])) bodies.set(company, [...(bodies.get(company) ?? []), body]);

  const refs: Record<string, string> = {};
  const blocks: string[] = [];
  let size = 0;
  let n = 0;
  for (const [company, jobs] of byCompany) {
    const shared = sharedLines(bodies.get(company) ?? []);
    const common = clip([...shared].filter((l) => !BOILERPLATE.test(l)), companyChars);
    const head = `## ${company}${common ? `\n\nWhat every ${company} advert says:\n${common}` : ""}`;
    const adverts: string[] = [];
    let added = head.length;
    for (const j of jobs) {
      const own = clip(linesOf(j.body).filter((l) => !shared.has(l) && (VISA.test(l) || !BOILERPLATE.test(l))), advertChars);
      const block = `### a${n + 1} · ${j.title} · ${j.location || "no location"}\n${own}`;
      // The first advert always goes in, so one long company cannot hold up the rest.
      if (n > 0 && size + added + block.length > maxChars) break;
      refs[`a${++n}`] = j.id;
      adverts.push(block);
      added += block.length;
    }
    if (!adverts.length) break;
    blocks.push([head, ...adverts].join("\n\n"));
    size += added;
    if (adverts.length < jobs.length) break;
  }
  await writeFile(join(dir, "adverts.md"), `# Adverts to read (${n})\n\n${blocks.join("\n\n")}\n`);
  await writeFile(join(dir, "read.json"), JSON.stringify({ refs }));
  return { adverts: n, waiting: unread.length - n };
}

// The same technology in the names adverts give it.
const ALIASES: Record<string, string> = {
  reactjs: "React",
  "react.js": "React",
  "react js": "React",
  ts: "TypeScript",
  js: "JavaScript",
  node: "Node.js",
  nodejs: "Node.js",
  "node js": "Node.js",
  nextjs: "Next.js",
  "next js": "Next.js",
  vuejs: "Vue",
  "vue.js": "Vue",
  "angular 2+": "Angular",
  angularjs: "Angular",
  golang: "Go",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  k8s: "Kubernetes",
  "google cloud": "GCP",
  "google cloud platform": "GCP",
  "amazon web services": "AWS",
  "microsoft azure": "Azure",
  "c sharp": "C#",
  dotnet: ".NET",
  ".net core": ".NET",
  "asp.net": ".NET",
  llm: "LLMs",
  "large language models": "LLMs",
  "react-native": "React Native",
  tailwindcss: "Tailwind CSS",
  tailwind: "Tailwind CSS",
  "html5": "HTML",
  "css3": "CSS",
  "spring": "Spring Boot",
  "ruby on rails": "Rails",
};
export function skillName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  return ALIASES[s.toLowerCase()] ?? s;
}
function skillList(raw: unknown, max: number, not = new Set<string>()): string[] {
  const out = new Map<string, string>();
  for (const s of Array.isArray(raw) ? raw : []) {
    const name = skillName(String(s ?? "")).slice(0, 40);
    const key = name.toLowerCase();
    if (name && !not.has(key) && !out.has(key)) out.set(key, name);
  }
  return [...out.values()].slice(0, max);
}

type ReadOutput = {
  adverts: { ref: string; family: string; skills: string[]; niceToHave: string[]; minYears: number; sponsorship: string; aiTools: boolean; fit: number; fitWhy: string }[];
};

// Stores the reads by ref. An advert the answer left out stays unread and comes back next run.
// Returns the run's summary in markdown, or null when the answer is not a read at all.
export async function saveReadOutput(runId: string, output: unknown, dir: string): Promise<string | null> {
  const out = output as ReadOutput | undefined;
  if (!out || !Array.isArray(out.adverts)) return null;
  const { refs } = JSON.parse(await readFile(join(dir, "read.json"), "utf8")) as { refs: Record<string, string> };
  const reads = new Map<string, JobRead>();
  for (const a of out.adverts) {
    const id = refs[a?.ref];
    if (!id || reads.has(id) || !TEXT_FAMILIES.includes(a.family as (typeof TEXT_FAMILIES)[number])) continue;
    const skills = skillList(a.skills, 15);
    reads.set(id, {
      textFamily: a.family,
      skills,
      niceSkills: skillList(a.niceToHave, 10, new Set(skills.map((s) => s.toLowerCase()))),
      minYears: Number.isInteger(a.minYears) && a.minYears > 0 && a.minYears <= 20 ? a.minYears : 0,
      textSponsorship: SPONSORSHIP.includes(a.sponsorship as (typeof SPONSORSHIP)[number]) ? a.sponsorship : "not said",
      aiTools: a.aiTools === true,
      fit: Number.isInteger(a.fit) && a.fit >= 1 && a.fit <= 5 ? a.fit : null,
      fitWhy: String(a.fitWhy ?? "").trim().slice(0, 200),
    });
  }
  saveJobReads(runId, reads);
  const all = [...reads.values()];
  const count = (pick: (r: JobRead) => string) => {
    const c = new Map<string, number>();
    for (const r of all) c.set(pick(r), (c.get(pick(r)) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  const left = Object.keys(refs).length - reads.size;
  return [
    `# Read, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${reads.size} adverts read${left ? `, ${left} left out of the answer (they come back next run)` : ""}.`,
    "",
    `- Family: ${count((r) => r.textFamily)}`,
    `- Sponsorship: ${count((r) => r.textSponsorship)}`,
    `- AI coding tools: ${all.filter((r) => r.aiTools).length}`,
    `- Fit: ${count((r) => (r.fit ? `${r.fit}/5` : "none"))}`,
  ].join("\n") + "\n";
}
