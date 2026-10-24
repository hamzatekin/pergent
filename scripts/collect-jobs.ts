// Collects software developer job adverts for the job market tracker: every open advert found this run
// goes to jobs.json in the current directory, and the runner saves the file to the database's jobs
// table, which keeps every advert with the day it was first and last seen, so the counts can reach back
// and an advert that stops being seen has closed. Sources, under $TASK_DIR/task.json's "collect":
//   boards     companies' own job boards, by slug per platform: Greenhouse (boards-api.greenhouse.io),
//              Lever (api.lever.co/v0/postings) and Ashby (api.ashbyhq.com/posting-api), public JSON
//              with no key and the full advert. An entry is a slug or `{ slug, name }`.
//   hn         the newest "Ask HN: Who is hiring?" thread, through the Algolia HN API: one request for
//              the thread, its top-level comments the adverts
//   himalayas  Himalayas' remote job search (himalayas.app/jobs/api/search), `country` and `queries`,
//              newest first, 20 to a page, until a page is all older than `days`
//   adzuna     Adzuna's search API (api.adzuna.com), `queries` in `category`, `days` back, 50 to a page
//              up to `pages`; needs ADZUNA_APP_ID and ADZUNA_APP_KEY (free: 250 calls a day, 2,500 a
//              month), and its description is a snippet
//   reed       Reed's jobseeker API (reed.co.uk/api/1.0), `queries`, then the details call for up to
//              `details` new adverts a run for the full text; needs REED_API_KEY
// Only adverts whose title matches `titles.include` and not `titles.exclude` are kept (developer roles,
// no managers), and only those in the UK or remote from it: a location naming one of `places`, or remote
// with no country or one of `regions`. Code reads what it can from each advert: the work mode, days in
// the office, a salary range, the role family and seniority from the title, and what the advert says
// about visa sponsorship. `sponsor` is the company's name on the Home Office register of licensed
// sponsors (the Skilled Worker route), downloaded from GOV.UK each run, matched by name: `sponsors` in
// the config maps a company to its register name where the brand and the legal name differ.
// An advert already in the jobs table (../../pergent.db, opened read-only) goes to jobs.json without its
// body, which the database keeps from the first time, so a run only refreshes when it was last seen.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NewJob as Job } from "../src/db.ts";

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const collect = config.collect ?? {};
const BODY = 8000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const deadline = Date.now() + (collect.budgetSeconds ?? 240) * 1000;
const log: string[] = [];
const say = (line: string) => {
  log.push(line);
  console.log(line);
};

const include = new RegExp(collect.titles?.include ?? "engineer|developer|programmer", "i");
const exclude = new RegExp(collect.titles?.exclude ?? "manager|director|head of", "i");
const words = (list: string[]) => new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
const places = words(collect.places ?? ["UK", "United Kingdom", "London"]);
const regions = words(collect.regions ?? ["Europe", "EMEA", "Worldwide", "Anywhere", "Global"]);

// What the database already holds. A fresh deployment has no file yet.
const seen = new Set<string>();
try {
  const db = new DatabaseSync(join("..", "..", "pergent.db"), { readOnly: true });
  for (const { id } of db.prepare("SELECT id FROM jobs").all() as { id: string }[]) seen.add(id);
  db.close();
} catch (err) {
  say(`no jobs read from the database: ${err instanceof Error ? err.message : err}`);
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function text(html: string) {
  return decode(
    html
      .replace(/<(br|\/p|p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}
const json = async (url: string, headers?: Record<string, string>) => (await get(url, headers)).json();

// --- What code reads from an advert ---

function family(title: string) {
  if (/\b(ios|android|mobile|react native|flutter|kotlin|swift)\b/i.test(title)) return "mobile";
  if (/full[\s-]?stack/i.test(title)) return "fullstack";
  if (/front[\s-]?end|\bui\b|web developer|javascript|typescript|\breact\b|\bvue\b|\bangular\b/i.test(title)) return "frontend";
  if (/\b(data|machine learning|ml|ai|llm|analytics)\b/i.test(title)) return "data";
  if (/devops|\bsre\b|site reliability|infrastructure|platform|cloud|security/i.test(title)) return "devops";
  if (/back[\s-]?end|\bapi\b|\b(java|python|golang|go|ruby|php|c#|\.net|node|rust|scala|elixir)\b/i.test(title)) return "backend";
  return "general";
}

function seniority(title: string) {
  if (/\b(intern|internship|placement)\b/i.test(title)) return "intern";
  if (/\b(graduate|grad|entry[\s-]level|apprentice)\b/i.test(title)) return "graduate";
  if (/\bjunior\b|\bjr\.?\b/i.test(title)) return "junior";
  if (/\bprincipal\b|\bdistinguished\b/i.test(title)) return "principal";
  if (/\bstaff\b/i.test(title)) return "staff";
  if (/\blead\b/i.test(title)) return "lead";
  if (/\bsenior\b|\bsr\.?\b/i.test(title)) return "senior";
  if (/\bmid\b|\bmid-level\b|\bintermediate\b/i.test(title)) return "mid";
  return null;
}

function workMode(location: string, body: string, given?: string | null) {
  const g = (given ?? "").toLowerCase();
  if (/remote/.test(g)) return "remote";
  if (/hybrid/.test(g)) return "hybrid";
  if (/on-?site|office/.test(g)) return "office";
  if (/hybrid/i.test(location)) return "hybrid";
  if (/remote/i.test(location)) return "remote";
  if (/\bhybrid\b/i.test(body)) return "hybrid";
  if (/\b(fully|100%) remote\b|\bremote[\s-]first\b/i.test(body)) return "remote";
  return null;
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
function officeDays(body: string) {
  const m = body.match(/\b(\d|one|two|three|four|five)(?:\s*(?:-|to)\s*(?:\d|two|three|four|five))?\s+days?\s+(?:a|per|each)\s+week\b[^.\n]{0,40}?\b(?:office|on[\s-]?site|in[\s-]person)\b/i) ??
    body.match(/\b(?:office|on[\s-]?site|in[\s-]person)\b[^.\n]{0,30}?\b(\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week\b/i);
  if (!m) return null;
  const n = NUMBERS[m[1].toLowerCase()] ?? Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

const NOT_OFFERED = [
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do not|don't|does not|doesn't|are not able|aren't able)\s+(?:currently\s+)?(?:to\s+)?(?:offer\s+|provide\s+)?sponsor(?:ship)?\b/i,
  /\b(?:not|never|won't|will not|do not|don't|does not|doesn't)\s+(?:now\s+or\s+in\s+the\s+future\s+)?(?:require|need)\s+(?:visa\s+|employer\s+)?sponsorship\b/i,
  /\b(?:unable|not able|cannot|can ?not|can't|won't|will not|do not|don't|does not|doesn't|are not|is not|aren't|isn't)\s+(?:currently\s+)?(?:able\s+)?(?:to\s+)?(?:offer|provide|support|sponsor|consider)\w*\b[^.\n]{0,50}\b(?:sponsor\w*|visas?)\b/i,
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bsponsorship\s+(?:is\s+)?(?:not|unavailable)\b/i,
  /\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+)?(?:visa\s+|employer\s+)?sponsorship\b/i,
  /\bnot\s+(?:be\s+)?(?:offering|providing|sponsoring)\b[^.\n]{0,30}\b(?:sponsor\w*|visas?)\b/i,
];
const OFFERED = [
  /\b(?:visa\s+)?sponsorship\s+(?:is\s+|can\s+be\s+|may\s+be\s+)?(?:available|offered|provided|possible|considered|supported)\b/i,
  /\b(?:we|can|will|able to|happy to|are able to)\s+(?:offer|provide|support|sponsor|consider)\s+(?:visa\s+|skilled worker\s+)?(?:sponsorship|visas?)\b/i,
  /\bsponsor\s+(?:your\s+|a\s+|the\s+right\s+)?(?:skilled worker\s+|work\s+)?visas?\b/i,
  /\bvisa\s+sponsorship\b[^.\n]{0,20}\b(?:offered|available|provided|included)\b/i,
  /\brelocation(?:\s+support)?\s+(?:and|&)\s+visa\s+sponsorship\b/i,
  /\bvisa\s+sponsorship\s+(?:where|if|when)\s+(?:applicable|eligible|needed|required)\b/i,
];
const RIGHT_TO_WORK = /\b(?:must|need to|needs to|should|will need to|required to)\s+(?:already\s+)?(?:have|hold|possess)\s+(?:the\s+|a\s+|full\s+|existing\s+|valid\s+|current\s+)*right\s+to\s+work\b|\bright\s+to\s+work\s+in\s+the\s+uk\s+(?:is\s+)?(?:required|essential)\b/i;
function sponsorship(body: string) {
  if (NOT_OFFERED.some((r) => r.test(body))) return "not offered";
  if (OFFERED.some((r) => r.test(body))) return "offered";
  if (RIGHT_TO_WORK.test(body)) return "right to work";
  if (/\bvisa\s+sponsorship\b|\bsponsor\w*\s+(?:a\s+|your\s+)?visas?\b|\bskilled worker visa\b/i.test(body)) return "mentioned";
  return null;
}

// A range such as "£55,000 - £70,000", "£60k–£80k", "$150K – $200K" or "£450-£550 per day"; one figure
// alone ("£65,000") counts as both ends. A day or hour rate is read only when the advert says so, and a
// figure in millions or billions (funding, revenue) is not pay.
const CURRENCY: Record<string, string> = { "£": "GBP", $: "USD", "€": "EUR" };
function salary(s: string): Pick<Job, "salaryMin" | "salaryMax" | "currency" | "salaryPeriod"> | null {
  const m = s.match(/([£$€])\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?!\s?(?:[mMbB]\b|bn\b|million|billion))(?:\s*(?:-|–|—|to)\s*(?:[£$€]\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?)?(?:[^.\n]{0,20}?\b(per|an?|\/)\s*(day|hour|annum|year))?/);
  if (!m) return null;
  const n = (v: string, k?: string) => Number(v.replace(/,/g, "")) * (k ? 1000 : 1);
  const lo = n(m[2], m[3] ?? m[5]);
  const hi = m[4] ? n(m[4], m[5] ?? m[3]) : lo;
  const period = m[7] ? (/day/i.test(m[7]) ? "day" : /hour/i.test(m[7]) ? "hour" : "year") : lo >= 10_000 ? "year" : null;
  if (!period || hi < lo || (period === "year" && lo < 10_000)) return null;
  return { salaryMin: lo, salaryMax: hi, currency: CURRENCY[m[1]], salaryPeriod: period };
}

// In the UK, or remote from it: a location naming one of `places`, or remote with no other country or
// one of `regions`. A location this cannot place ("Remote (US)", "Berlin") is left out.
function wanted(location: string, remote = false) {
  if (places.test(location)) return true;
  if (!(remote || /remote/i.test(location))) return false;
  const rest = location.replace(/remote|hybrid|[(),;/|-]/gi, " ").trim();
  return rest === "" || regions.test(rest);
}

// --- The register of licensed sponsors ---

const SUFFIX = /\b(limited|ltd|plc|llp|llc|inc|incorporated|corp|corporation|co|company|uk|u\.k\.|gb|group|holdings?|international|europe|the)\b/g;
const norm = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/\bt\/a\b.*$/, "").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

const register = new Map<string, string>();
async function loadRegister() {
  const page = await json("https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers");
  const csv = page.details?.attachments?.find((a: { url: string }) => /\.csv$/i.test(a.url))?.url;
  if (!csv) throw new Error("no CSV on the register page");
  const rows = (await (await get(csv, { accept: "text/csv" })).text()).split(/\r?\n/);
  for (const row of rows.slice(1)) {
    const cells = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
    const [name, , , , route] = cells;
    if (!name || route !== "Skilled Worker") continue;
    const key = norm(name);
    if (key && !register.has(key)) register.set(key, name);
  }
  say(`sponsor register: ${register.size} Skilled Worker sponsors (${csv.split("/").pop()})`);
}

// The company's register name: its own name once suffixes are dropped, else the one register name that
// is it followed only by generic words ("Monzo" is "Monzo Bank Ltd", "Wayve" "Wayve Technologies Ltd";
// "Elastic" is not "Elastic Path Software"). Several such names is no match. A short brand can still
// match a stranger of the same name, so the register name is kept beside the advert to check.
const GENERIC = new Set(["bank", "technologies", "technology", "tech", "software", "online", "payments", "operations", "labs", "ai", "io", "com", "market", "networks", "systems", "services", "digital", "platform", "solutions", "data"]);
const sponsors: Record<string, string> = collect.sponsors ?? {};
const sponsorCache = new Map<string, string | null>();
function sponsorOf(company: string) {
  if (!register.size || !company) return null;
  if (sponsorCache.has(company)) return sponsorCache.get(company)!;
  const given = sponsors[company];
  const key = norm(given ?? company);
  let found = register.get(key) ?? null;
  if (!found && key.length >= 4) {
    const starts = [...register.entries()].filter(([k]) => k.startsWith(`${key} `) && k.slice(key.length + 1).split(" ").every((w) => GENERIC.has(w)));
    if (starts.length === 1) found = starts[0][1];
  }
  sponsorCache.set(company, found);
  return found;
}

// --- Sources ---

type Raw = Omit<Job, "workMode" | "officeDays" | "family" | "seniority" | "salaryMin" | "salaryMax" | "currency" | "salaryPeriod" | "salaryPredicted" | "sponsorship" | "sponsor"> & {
  mode?: string | null;
  pay?: string | null;
  money?: Pick<Job, "salaryMin" | "salaryMax" | "currency" | "salaryPeriod"> & { predicted?: boolean };
};

type Board = string | { slug: string; name?: string };
const slugOf = (b: Board) => (typeof b === "string" ? b : b.slug);
const nameOf = (b: Board) => (typeof b === "string" ? undefined : b.name) ?? slugOf(b).replace(/(^|[-_])(\w)/g, (_, s, c) => `${s ? " " : ""}${c.toUpperCase()}`);

async function greenhouse(b: Board): Promise<Raw[]> {
  const data = await json(`https://boards-api.greenhouse.io/v1/boards/${slugOf(b)}/jobs?content=true`);
  return (data.jobs ?? []).map((j: { id: number; title: string; location?: { name?: string }; absolute_url: string; first_published?: string; updated_at?: string; company_name?: string; content?: string }) => ({
    id: `greenhouse:${j.id}`,
    source: "greenhouse",
    company: typeof b === "string" ? (j.company_name ?? nameOf(b)).trim().replace(/^careers at /i, "").replace(/\s+-\s+external$/i, "") : nameOf(b),
    title: j.title.trim(),
    location: j.location?.name ?? "",
    url: j.absolute_url,
    postedAt: j.first_published ?? j.updated_at ?? null,
    body: text(decode(j.content ?? "")),
  }));
}

async function lever(b: Board): Promise<Raw[]> {
  const data = await json(`https://api.lever.co/v0/postings/${slugOf(b)}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: {
    id: string;
    text: string;
    categories?: { location?: string; allLocations?: string[] };
    country?: string;
    workplaceType?: string;
    hostedUrl: string;
    createdAt?: number;
    descriptionPlain?: string;
    lists?: { text: string; content: string }[];
    additionalPlain?: string;
    salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  }) => {
    const r = j.salaryRange;
    const period = r?.interval ? (/day/i.test(r.interval) ? "day" : /hour/i.test(r.interval) ? "hour" : "year") : null;
    return {
      id: `lever:${j.id}`,
      source: "lever",
      company: nameOf(b),
      title: j.text.trim(),
      location: [...new Set([...(j.categories?.allLocations ?? []), j.categories?.location ?? ""].filter(Boolean))].join("; ") + (j.country === "GB" ? " (UK)" : ""),
      mode: j.workplaceType,
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      body: [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `${l.text}\n${text(l.content)}`), j.additionalPlain ?? ""].join("\n").trim(),
      money: r?.min && period ? { salaryMin: r.min, salaryMax: r.max ?? r.min, currency: r.currency ?? null, salaryPeriod: period } : undefined,
    };
  });
}

async function ashby(b: Board): Promise<Raw[]> {
  const data = await json(`https://api.ashbyhq.com/posting-api/job-board/${slugOf(b)}?includeCompensation=true`);
  return (data.jobs ?? [])
    .filter((j: { isListed?: boolean }) => j.isListed !== false)
    .map((j: {
      id: string;
      title: string;
      location?: string;
      secondaryLocations?: { location?: string }[];
      workplaceType?: string;
      isRemote?: boolean;
      jobUrl: string;
      publishedAt?: string;
      descriptionPlain?: string;
      compensation?: { compensationTierSummary?: string };
    }) => ({
      id: `ashby:${j.id}`,
      source: "ashby",
      company: nameOf(b),
      title: j.title.trim(),
      location: [j.location ?? "", ...(j.secondaryLocations ?? []).map((l) => l.location ?? "")].filter(Boolean).join("; "),
      mode: j.workplaceType ?? (j.isRemote ? "remote" : null),
      url: j.jobUrl,
      postedAt: j.publishedAt ?? null,
      body: (j.descriptionPlain ?? "").trim(),
      pay: j.compensation?.compensationTierSummary ?? null,
    }));
}

// The newest Who is hiring thread; an advert's first line is "Company | Role | Location | ..." by the
// thread's rules, which is what its title and company are taken from.
async function hn(): Promise<Raw[]> {
  const search = await json("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10");
  const story = (search.hits ?? []).find((h: { title: string }) => /^Ask HN: Who is hiring\?/i.test(h.title));
  if (!story) throw new Error("no Who is hiring thread");
  const thread = await json(`https://hn.algolia.com/api/v1/items/${story.objectID}`);
  say(`hn: ${story.title}, ${(thread.children ?? []).length} comments`);
  return (thread.children ?? [])
    .filter((c: { text?: string | null }) => c.text)
    .map((c: { id: number; text: string; created_at: string }) => {
      const body = text(c.text);
      const first = body.split("\n")[0];
      const parts = first.split("|").map((p) => p.trim());
      return {
        id: `hn:${c.id}`,
        source: "hn",
        company: parts[0]?.replace(/\(.*?\)/g, "").trim().slice(0, 80) ?? "",
        title: (parts.find((p, i) => i > 0 && include.test(p)) ?? first).slice(0, 160),
        location: parts.slice(1).filter((p) => !include.test(p)).join(" | ").slice(0, 200),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        postedAt: c.created_at,
        body,
      };
    });
}

async function himalayas(query: string): Promise<Raw[]> {
  const h = collect.himalayas ?? {};
  const since = Date.now() - (h.days ?? 3) * 86_400_000;
  const out: Raw[] = [];
  for (let page = 1; page <= (h.pages ?? 10) && Date.now() < deadline; page++) {
    const params = new URLSearchParams({ q: query, country: h.country ?? "United Kingdom", sort: "recent", page: String(page) });
    const data = await json(`https://himalayas.app/jobs/api/search?${params}`);
    const jobs = data.jobs ?? [];
    for (const j of jobs as {
      guid: string;
      title: string;
      companyName: string;
      locationRestrictions?: string[];
      minSalary?: number | null;
      maxSalary?: number | null;
      currency?: string | null;
      salaryPeriod?: string | null;
      pubDate: number;
      description?: string;
      seniority?: string[];
    }[]) {
      out.push({
        id: `himalayas:${j.guid}`,
        source: "himalayas",
        company: j.companyName,
        title: j.title.trim(),
        location: `Remote${j.locationRestrictions?.length ? ` (${j.locationRestrictions.join(", ")})` : ""}`,
        mode: "remote",
        url: j.guid,
        postedAt: new Date(j.pubDate * 1000).toISOString(),
        body: text(j.description ?? ""),
        money: j.minSalary && j.currency
          ? { salaryMin: j.minSalary, salaryMax: j.maxSalary ?? j.minSalary, currency: j.currency, salaryPeriod: /hour|day|week|month/i.exec(j.salaryPeriod ?? "")?.[0].toLowerCase() ?? "year" }
          : undefined,
      });
    }
    // A page holds up to 20, often fewer; an empty one is the end.
    if (!jobs.length || jobs.every((j: { pubDate: number }) => j.pubDate * 1000 < since)) break;
  }
  return out;
}

async function adzuna(query: string): Promise<Raw[]> {
  const a = collect.adzuna ?? {};
  const out: Raw[] = [];
  for (let page = 1; page <= (a.pages ?? 2) && Date.now() < deadline; page++) {
    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID!,
      app_key: process.env.ADZUNA_APP_KEY!,
      results_per_page: "50",
      what: query,
      max_days_old: String(a.days ?? 2),
      sort_by: "date",
      "content-type": "application/json",
    });
    if (a.category) params.set("category", a.category);
    const data = await json(`https://api.adzuna.com/v1/api/jobs/${a.country ?? "gb"}/search/${page}?${params}`);
    const results = data.results ?? [];
    for (const j of results as {
      id: string;
      title: string;
      company?: { display_name?: string };
      location?: { display_name?: string };
      redirect_url: string;
      created?: string;
      description?: string;
      salary_min?: number;
      salary_max?: number;
      salary_is_predicted?: string | number;
      contract_time?: string;
    }[]) {
      out.push({
        id: `adzuna:${j.id}`,
        source: "adzuna",
        company: j.company?.display_name ?? "",
        title: text(j.title),
        location: `${j.location?.display_name ?? ""} (UK)`,
        url: j.redirect_url,
        postedAt: j.created ?? null,
        body: text(j.description ?? ""),
        money: j.salary_min
          ? { salaryMin: Math.round(j.salary_min), salaryMax: Math.round(j.salary_max ?? j.salary_min), currency: "GBP", salaryPeriod: j.salary_min < 1000 ? "day" : "year", predicted: String(j.salary_is_predicted) === "1" }
          : undefined,
      });
    }
    if (results.length < 50) break;
  }
  return out;
}

const reedAuth = () => ({ authorization: `Basic ${Buffer.from(`${process.env.REED_API_KEY}:`).toString("base64")}` });
async function reed(query: string): Promise<Raw[]> {
  const r = collect.reed ?? {};
  const params = new URLSearchParams({ keywords: query, resultsToTake: "100" });
  const data = await json(`https://www.reed.co.uk/api/1.0/search?${params}`, reedAuth());
  const since = Date.now() - (r.days ?? 2) * 86_400_000;
  const day = (d: string) => {
    const [dd, mm, yyyy] = d.split("/");
    return new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  };
  return (data.results ?? [])
    .filter((j: { date: string }) => day(j.date).getTime() >= since)
    .map((j: { jobId: number; employerName: string; jobTitle: string; locationName: string; minimumSalary?: number; maximumSalary?: number; currency?: string; date: string; jobDescription?: string; jobUrl: string }) => ({
      id: `reed:${j.jobId}`,
      source: "reed",
      company: j.employerName,
      title: j.jobTitle.trim(),
      location: `${j.locationName} (UK)`,
      url: j.jobUrl,
      postedAt: day(j.date).toISOString(),
      body: text(j.jobDescription ?? ""),
      money: j.minimumSalary
        ? { salaryMin: j.minimumSalary, salaryMax: j.maximumSalary ?? j.minimumSalary, currency: j.currency ?? "GBP", salaryPeriod: j.minimumSalary < 1000 ? "day" : "year" }
        : undefined,
    }));
}

// The full text of a new Reed advert, which the search cuts to a snippet.
async function reedDetails(job: Raw) {
  const data = await json(`https://www.reed.co.uk/api/1.0/jobs/${job.id.slice(5)}`, reedAuth());
  if (data.jobDescription) job.body = text(data.jobDescription);
}

// --- The run ---

const found: Raw[] = [];
async function fetchFrom(label: string, run: () => Promise<Raw[]>) {
  if (Date.now() > deadline) return say(`${label}: skipped, out of time`);
  try {
    const jobs = await run();
    found.push(...jobs);
    say(`${label}: ${jobs.length}`);
  } catch (err) {
    say(`${label}: failed, ${err instanceof Error ? err.message : err}`);
  }
}

const boards = collect.boards ?? {};
const tasks: [string, () => Promise<Raw[]>][] = [
  ...((boards.greenhouse ?? []) as Board[]).map((b): [string, () => Promise<Raw[]>] => [`greenhouse ${slugOf(b)}`, () => greenhouse(b)]),
  ...((boards.lever ?? []) as Board[]).map((b): [string, () => Promise<Raw[]>] => [`lever ${slugOf(b)}`, () => lever(b)]),
  ...((boards.ashby ?? []) as Board[]).map((b): [string, () => Promise<Raw[]>] => [`ashby ${slugOf(b)}`, () => ashby(b)]),
  ...(collect.hn ? [["hn", hn] as [string, () => Promise<Raw[]>]] : []),
  ...((collect.himalayas?.queries ?? []) as string[]).map((q): [string, () => Promise<Raw[]>] => [`himalayas "${q}"`, () => himalayas(q)]),
];
const adzunaQueries: string[] = collect.adzuna?.queries ?? [];
if (adzunaQueries.length && !(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY)) say("adzuna: skipped, no ADZUNA_APP_ID and ADZUNA_APP_KEY");
else tasks.push(...adzunaQueries.map((q): [string, () => Promise<Raw[]>] => [`adzuna "${q}"`, () => adzuna(q)]));
const reedQueries: string[] = collect.reed?.queries ?? [];
if (reedQueries.length && !process.env.REED_API_KEY) say("reed: skipped, no REED_API_KEY");
else tasks.push(...reedQueries.map((q): [string, () => Promise<Raw[]>] => [`reed "${q}"`, () => reed(q)]));

await Promise.all([
  loadRegister().catch((err) => say(`sponsor register: failed, ${err instanceof Error ? err.message : err}`)),
  ...Array.from({ length: 6 }, async () => {
    for (let t = tasks.shift(); t; t = tasks.shift()) await fetchFrom(...t);
  }),
]);

// Developer roles in the UK or remote from it, each once.
const unique = new Map<string, Raw>();
let offTitle = 0;
let offPlace = 0;
for (const j of found) {
  if (unique.has(j.id)) continue;
  if (!include.test(j.title) || exclude.test(j.title)) {
    offTitle++;
    continue;
  }
  if (!wanted(j.location, /remote/i.test(j.mode ?? ""))) {
    offPlace++;
    continue;
  }
  unique.set(j.id, j);
}

const fresh = [...unique.values()].filter((j) => !seen.has(j.id));
const details: number = collect.reed?.details ?? 200;
const reedNew = fresh.filter((j) => j.source === "reed").slice(0, details);
for (let i = 0; i < reedNew.length && Date.now() < deadline; i += 6) {
  await Promise.all(reedNew.slice(i, i + 6).map((j) => reedDetails(j).catch(() => {})));
}

const jobs: Job[] = [...unique.values()].map((j) => {
  const body = j.body.length > BODY ? `${j.body.slice(0, BODY)}…` : j.body;
  const money = j.money ?? salary(j.pay ?? "") ?? salary(`${j.title}\n${j.location}`) ?? salary(body);
  return {
    id: j.id,
    source: j.source,
    company: j.company,
    title: j.title,
    location: j.location,
    workMode: workMode(j.location, body, j.mode),
    officeDays: officeDays(body),
    family: family(j.title),
    seniority: seniority(j.title),
    salaryMin: money?.salaryMin ?? null,
    salaryMax: money?.salaryMax ?? null,
    currency: money?.currency ?? null,
    salaryPeriod: money?.salaryPeriod ?? null,
    salaryPredicted: Boolean(j.money?.predicted),
    sponsorship: sponsorship(body),
    sponsor: sponsorOf(j.company),
    url: j.url,
    postedAt: j.postedAt,
    // The database keeps the body from the first time; a known advert is only marked seen.
    body: seen.has(j.id) ? "" : body,
  };
});

await writeFile("jobs.json", JSON.stringify(jobs));
const count = (f: (j: Job) => boolean) => jobs.filter(f).length;
const by = (key: (j: Job) => string | null) =>
  [...new Set(jobs.map(key))].map((k) => `${count((j) => key(j) === k)} ${k ?? "unknown"}`).join(", ");
say(`kept ${jobs.length} adverts (${fresh.length} new), left out ${offTitle} by title and ${offPlace} by place`);
say(`by source: ${by((j) => j.source)}`);
say(`by family: ${by((j) => j.family)}`);
say(`work mode: ${by((j) => j.workMode)}`);
say(`sponsorship in the advert: ${by((j) => j.sponsorship)}; company on the sponsor register: ${count((j) => j.sponsor !== null)}`);
say(`with a salary: ${count((j) => j.salaryMin !== null)}`);
await writeFile("collect.log", log.join("\n") + "\n");
