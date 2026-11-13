import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { RunMeta } from "./runner.ts";
import type { Paper } from "./paper.ts";

// The database is the index the API reads; each run directory stays the archive (log, stderr, inputs).
// It lives under runs/ so it is on the same volume as the run directories. `paper` is the structured
// output of a run, `output` its markdown rendering (or, for runs from before structured output, the
// markdown the model wrote, with no paper).
export type RunRow = { meta: RunMeta; output: string; images: Record<string, string>; paper: Paper | null };
// A newsletter issue as published (scripts/fetch-newsletters.ts writes them to a run's issues.json),
// for reading it whole on the Newsletters page. `date` is ISO, `html` cleaned of the email's styling.
export type NewIssue = { feed: string; title: string; url: string; date: string; html: string };
export type IssueRow = { id: number; feed: string; title: string; url: string; date: string };
export type PostRow = { id: string; source: string; community: string; author: string; postedAt: string; title: string; body: string; url: string; budget: string | null; kind: string | null };
// A problem of a radar (src/ideas.ts): what several posts complain about, named in the owners'
// words. `task` is the radar it belongs to, the task that collects and sorts its posts (ideas, gym).
// `status` is open, starred, killed (hidden, its posts still land on it) or merged (into
// `merged_into`, which has its mentions now). `judgeAsked` is set by the page's Judge again.
export type ProblemRow = { id: number; task: string; name: string; category: string; summary: string; status: string; mergedInto: number | null; createdAt: string; judgeAsked: string | null };
// One judgement of a problem (src/ideas.ts): the verdict code derived from the model's scores.
export type Score = { score: number; why: string };
export type VerdictRow = {
  id: number;
  problemId: number;
  verdict: "worth" | "watch" | "pass";
  hardNo: string;
  scores: Record<string, Score>;
  competitors: { name: string; url: string; note: string }[];
  size: string;
  reason: string;
  test: string;
  /** The problem's mentions when it was judged, to tell when it has grown enough to judge again. */
  mentions: number;
  createdAt: string;
};
// What the sort made of one post: the problem it raises (none when it raises none, or `note` says why
// it was set aside) and what it says about it.
export type Mention = { postId: string; problemId: number | null; recurring: boolean; cost: string; workaround: string; quote: string; note?: string };
// A post the ideas radar collected (scripts/collect-posts.ts writes them to a run's posts.json): a
// Reddit post, a Freelancer job or a forum topic, with the kind Jev gave it. `kept` is false when
// the kind is one the task drops; such a post keeps no body and is stored only so it is not fetched
// and judged again.
export type NewPost = {
  id: string;
  source: string;
  community: string;
  author: string;
  postedAt: string;
  title: string;
  body: string;
  url: string;
  budget?: string;
  kind?: string | null;
  kindP?: number | null;
  kept: boolean;
};

// A job advert the job market tracker collected (scripts/collect-jobs.ts writes them to a run's jobs.json,
// with the fields code read from it). An advert already stored comes back with an empty body and only
// marks the day it was last seen; one that stops being seen has closed.
export type NewJob = {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  /** remote, hybrid or office, when the advert says. */
  workMode: string | null;
  officeDays: number | null;
  /** frontend, backend, fullstack, mobile, data, devops, or general when the title does not say. */
  family: string;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  /** year, month, week, day or hour. */
  salaryPeriod: string | null;
  /** Adzuna's own estimate, not the employer's figure. */
  salaryPredicted: boolean;
  /** offered, not offered, right to work (the advert asks for it, which usually means no sponsorship), or
   * mentioned (it speaks of sponsorship or visas in words code cannot read). */
  sponsorship: string | null;
  sponsor: string | null;
  url: string;
  postedAt: string | null;
  body: string;
};

// A rental listing the homes task found in a Rightmove or OpenRent search (scripts/collect-homes.ts): what the search
// results say about it. `pricePcm` is the rent a calendar month, worked out from a weekly price.
export type HomeListing = {
  id: string;
  url: string;
  address: string;
  lat: number | null;
  lng: number | null;
  pricePcm: number;
  beds: number | null;
  baths: number | null;
  /** The property type: Flat, Apartment, Terraced, Semi-Detached, Studio... (OpenRent's from its title) */
  type: string;
  agent: string;
  phone: string | null;
  image: string | null;
  summary: string;
  /** When its site first showed it. */
  listedAt: string | null;
  availableFrom: string | null;
};
// What a listing's own page adds, fetched once per listing. `epc` are the EPC chart images, which give
// the rating only as a picture.
export type HomeDetails = {
  postcode: string | null;
  description: string;
  keyFeatures: string[];
  furnish: string | null;
  deposit: number | null;
  minTermMonths: number | null;
  letType: string | null;
  /** "Now" or a date as the page writes it (dd/mm/yyyy). */
  availableFrom: string | null;
  councilTaxBand: string | null;
  councilTaxIncluded: boolean;
  sqm: number | null;
  epc: string[];
  floorplans: string[];
  images: string[];
  /** Parking, garden, heating and the rest, as the agent ticked them. */
  features: Record<string, string[]>;
  stations: { name: string; miles: number }[];
  phone: string | null;
  /** The page says the listing is taken down. */
  archived: boolean;
};
// What a run of collect-homes.ts hands the runner: the listings its searches found (each marked seen
// now), the pages it fetched, and, when it searched every price band without a failure, when that sweep
// started: a listing not seen since then has gone.
export type HomesFile = { sweptAt: string | null; listings: HomeListing[]; details: Record<string, HomeDetails> };

let db: DatabaseSync | undefined;

export function openDb(runsDir: string): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(join(runsDir, "pergent.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      task        TEXT NOT NULL,
      run_id      TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      status      TEXT NOT NULL,
      exit_code   INTEGER,
      timed_out   INTEGER,
      cost_usd    REAL,
      turns       INTEGER,
      output      TEXT NOT NULL DEFAULT '',
      images      TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (task, run_id)
    );
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mutes (
      task       TEXT NOT NULL,
      phrase     TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task, phrase)
    );
    CREATE TABLE IF NOT EXISTS issues (
      id     INTEGER PRIMARY KEY,
      url    TEXT NOT NULL UNIQUE,
      feed   TEXT NOT NULL,
      title  TEXT NOT NULL,
      date   TEXT NOT NULL,
      html   TEXT NOT NULL,
      task   TEXT NOT NULL,
      run_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issues_by_feed ON issues (feed, date);
    CREATE TABLE IF NOT EXISTS posts (
      id        TEXT PRIMARY KEY,
      source    TEXT NOT NULL,
      community TEXT NOT NULL,
      author    TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL,
      title     TEXT NOT NULL,
      body      TEXT NOT NULL DEFAULT '',
      url       TEXT NOT NULL,
      budget    TEXT,
      kind      TEXT,
      kind_p    REAL,
      kept      INTEGER NOT NULL,
      task      TEXT NOT NULL,
      run_id    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_by_date ON posts (posted_at);
    CREATE TABLE IF NOT EXISTS problems (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'open',
      merged_into INTEGER,
      created_at  TEXT NOT NULL,
      run_id      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mentions (
      post_id    TEXT PRIMARY KEY,
      problem_id INTEGER,
      recurring  INTEGER NOT NULL DEFAULT 0,
      cost       TEXT NOT NULL DEFAULT '',
      workaround TEXT NOT NULL DEFAULT '',
      quote      TEXT NOT NULL DEFAULT '',
      note       TEXT,
      run_id     TEXT NOT NULL,
      sorted_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mentions_by_problem ON mentions (problem_id);
    CREATE TABLE IF NOT EXISTS verdicts (
      id          INTEGER PRIMARY KEY,
      problem_id  INTEGER NOT NULL,
      verdict     TEXT NOT NULL,
      hard_no     TEXT NOT NULL DEFAULT '',
      scores      TEXT NOT NULL,
      competitors TEXT NOT NULL DEFAULT '[]',
      size        TEXT NOT NULL DEFAULT '',
      reason      TEXT NOT NULL DEFAULT '',
      test        TEXT NOT NULL DEFAULT '',
      mentions    INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      run_id      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS verdicts_by_problem ON verdicts (problem_id, id);
    CREATE TABLE IF NOT EXISTS overviews (
      id         INTEGER PRIMARY KEY,
      task       TEXT NOT NULL,
      summary    TEXT NOT NULL,
      categories TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_id     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS overviews_by_task ON overviews (task, id);
    CREATE TABLE IF NOT EXISTS jobs (
      id               TEXT PRIMARY KEY,
      source           TEXT NOT NULL,
      company          TEXT NOT NULL,
      title            TEXT NOT NULL,
      location         TEXT NOT NULL,
      work_mode        TEXT,
      office_days      INTEGER,
      family           TEXT NOT NULL,
      seniority        TEXT,
      salary_min       REAL,
      salary_max       REAL,
      currency         TEXT,
      salary_period    TEXT,
      salary_predicted INTEGER NOT NULL DEFAULT 0,
      sponsorship      TEXT,
      sponsor          TEXT,
      url              TEXT NOT NULL,
      posted_at        TEXT,
      body             TEXT NOT NULL DEFAULT '',
      first_seen       TEXT NOT NULL,
      last_seen        TEXT NOT NULL,
      task             TEXT NOT NULL,
      run_id           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_by_first_seen ON jobs (first_seen);
    CREATE TABLE IF NOT EXISTS homes (
      id             TEXT PRIMARY KEY,
      url            TEXT NOT NULL,
      address        TEXT NOT NULL,
      postcode       TEXT,
      lat            REAL,
      lng            REAL,
      price_pcm      INTEGER NOT NULL,
      prices         TEXT NOT NULL DEFAULT '[]',
      beds           INTEGER,
      baths          INTEGER,
      type           TEXT NOT NULL DEFAULT '',
      agent          TEXT NOT NULL DEFAULT '',
      phone          TEXT,
      image          TEXT,
      summary        TEXT NOT NULL DEFAULT '',
      listed_at      TEXT,
      available_from TEXT,
      details        TEXT,
      details_at     TEXT,
      first_seen     TEXT NOT NULL,
      last_seen      TEXT NOT NULL,
      task           TEXT NOT NULL,
      run_id         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS homes_by_first_seen ON homes (first_seen);
    -- The police's street-level crimes around the homes search (src/crime.ts), the newest months only.
    CREATE TABLE IF NOT EXISTS crimes (
      id       INTEGER PRIMARY KEY,
      month    TEXT NOT NULL,
      category TEXT NOT NULL,
      lat      REAL NOT NULL,
      lng      REAL NOT NULL,
      street   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS crimes_by_month ON crimes (month);
    -- The EPC register (src/epc.ts): what a postcode search answered, kept 30 days, and each certificate
    -- fetched, kept for good (a certificate never changes; a new one gets a new number).
    CREATE TABLE IF NOT EXISTS epc_postcodes (
      postcode   TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      entries    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS epc_certs (
      number TEXT PRIMARY KEY,
      cert   TEXT NOT NULL
    );
  `);
  // Added after the first deployments; a database from before gets the column on start.
  const columns = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "paper")) db.exec("ALTER TABLE runs ADD COLUMN paper TEXT");
  const problemColumns = db.prepare("PRAGMA table_info(problems)").all() as { name: string }[];
  if (!problemColumns.some((c) => c.name === "judge_asked")) db.exec("ALTER TABLE problems ADD COLUMN judge_asked TEXT");
  // A second radar (gym) came after the first; what was there before is the ideas radar's.
  if (!problemColumns.some((c) => c.name === "task")) db.exec("ALTER TABLE problems ADD COLUMN task TEXT NOT NULL DEFAULT 'ideas'");
  // What the model read from an advert's text (src/jobs.ts), on the advert's row; read_at is empty until then.
  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  for (const [name, type] of Object.entries(JOB_READ_COLUMNS)) {
    if (!jobColumns.some((c) => c.name === name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  }
  // The fit came a day after the first reads; the adverts read without it are read again, once.
  if (jobColumns.some((c) => c.name === "read_at") && !jobColumns.some((c) => c.name === "fit")) db.exec("UPDATE jobs SET read_at = NULL");
  // What the model read from a listing (src/homes.ts) and its commute (src/commute.ts), on the listing's
  // row; read_at is empty until then.
  const homeColumns = db.prepare("PRAGMA table_info(homes)").all() as { name: string }[];
  for (const [name, type] of Object.entries(HOME_COLUMNS)) {
    if (!homeColumns.some((c) => c.name === name)) db.exec(`ALTER TABLE homes ADD COLUMN ${name} ${type}`);
  }
  // The rent a read was made at came after the first reads, which were all made at the rent they show.
  if (!homeColumns.some((c) => c.name === "read_pcm")) db.exec("UPDATE homes SET read_pcm = price_pcm WHERE read_at IS NOT NULL");
  renameTasks(runsDir);
  moveMutes();
  importRuns(runsDir);
  return db;
}

function use(): DatabaseSync {
  if (!db) throw new Error("openDb() first");
  return db;
}

type Row = {
  task: string; run_id: string; started_at: string; finished_at: string | null; status: RunMeta["status"];
  exit_code: number | null; timed_out: number | null; cost_usd: number | null; turns: number | null;
};

function toMeta(r: Row): RunMeta {
  return {
    task: r.task,
    runId: r.run_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    status: r.status,
    exitCode: r.exit_code,
    timedOut: r.timed_out === null ? undefined : r.timed_out === 1,
    costUsd: r.cost_usd ?? undefined,
    turns: r.turns ?? undefined,
  };
}

const META_COLUMNS = "task, run_id, started_at, finished_at, status, exit_code, timed_out, cost_usd, turns";

export function saveRun(meta: RunMeta, output = "", images: Record<string, string> = {}, paper: Paper | null = null) {
  use().prepare(`
    INSERT INTO runs (${META_COLUMNS}, output, images, paper)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (task, run_id) DO UPDATE SET
      finished_at = excluded.finished_at, status = excluded.status, exit_code = excluded.exit_code,
      timed_out = excluded.timed_out, cost_usd = excluded.cost_usd, turns = excluded.turns,
      output = excluded.output, images = excluded.images, paper = excluded.paper
  `).run(
    meta.task, meta.runId, meta.startedAt, meta.finishedAt ?? null, meta.status, meta.exitCode ?? null,
    meta.timedOut === undefined ? null : Number(meta.timedOut), meta.costUsd ?? null, meta.turns ?? null,
    output, JSON.stringify(images), paper && JSON.stringify(paper),
  );
}

export function listRuns(task: string): RunMeta[] {
  const rows = use().prepare(`SELECT ${META_COLUMNS} FROM runs WHERE task = ? ORDER BY run_id DESC`).all(task);
  return (rows as Row[]).map(toMeta);
}

export function getRun(task: string, runId: string): RunRow | null {
  const row = use().prepare(`SELECT ${META_COLUMNS}, output, images, paper FROM runs WHERE task = ? AND run_id = ?`).get(task, runId);
  if (!row) return null;
  const r = row as Row & { output: string; images: string; paper: string | null };
  return { meta: toMeta(r), output: r.output, images: JSON.parse(r.images), paper: r.paper ? JSON.parse(r.paper) : null };
}

// The runs of a task that started at or after `since` (an ISO time), oldest first: what the scheduler
// weighs a slot against.
export function runsSince(task: string, since: string): { status: RunMeta["status"]; finishedAt: string | null }[] {
  return use().prepare("SELECT status, finished_at AS finishedAt FROM runs WHERE task = ? AND started_at >= ? ORDER BY started_at").all(task, since) as { status: RunMeta["status"]; finishedAt: string | null }[];
}

// A few named values, e.g. last_read: when the UI last fetched a run, which gates the scheduler.
export function getState(key: string): string | null {
  const row = use().prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string) {
  use().prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

// The never-show list of a task (src/mute.ts), oldest first. A phrase is kept once, whatever its case.
export function listMutes(task: string): string[] {
  const rows = use().prepare("SELECT phrase FROM mutes WHERE task = ? ORDER BY created_at").all(task) as { phrase: string }[];
  return rows.map((r) => r.phrase);
}

export function addMute(task: string, phrase: string) {
  use().prepare("INSERT OR IGNORE INTO mutes (task, phrase, created_at) VALUES (?, ?, ?)").run(task, phrase, new Date().toISOString());
}

export function removeMute(task: string, phrase: string) {
  use().prepare("DELETE FROM mutes WHERE task = ? AND phrase = ?").run(task, phrase);
}

// An issue is kept once, by URL: a run that fetches one again (it was left for the next digest) changes nothing.
export function saveIssues(task: string, runId: string, issues: NewIssue[]) {
  const insert = use().prepare("INSERT OR IGNORE INTO issues (url, feed, title, date, html, task, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const i of issues) insert.run(i.url, i.feed, i.title, i.date, i.html, task, runId);
}

// A post is kept once, by id; nothing is ever deleted, since the radar's counts reach back to the first post.
export function savePosts(task: string, runId: string, posts: NewPost[]) {
  const insert = use().prepare(`
    INSERT OR IGNORE INTO posts (id, source, community, author, posted_at, title, body, url, budget, kind, kind_p, kept, task, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  use().exec("BEGIN");
  try {
    for (const p of posts) {
      insert.run(p.id, p.source, p.community, p.author, p.postedAt, p.title, p.kept ? p.body : "", p.url, p.budget ?? null, p.kind ?? null, p.kindP ?? null, Number(p.kept), task, runId);
    }
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// An advert is stored once, by id, with its body; seen again, it gets the day and whatever code reads
// from it now (the register and the patterns can change), and keeps its body and first_seen.
export function saveJobs(task: string, runId: string, jobs: NewJob[]) {
  const now = new Date().toISOString();
  const upsert = use().prepare(`
    INSERT INTO jobs (id, source, company, title, location, work_mode, office_days, family, seniority, salary_min, salary_max, currency,
      salary_period, salary_predicted, sponsorship, sponsor, url, posted_at, body, first_seen, last_seen, task, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title, location = excluded.location, work_mode = excluded.work_mode, family = excluded.family,
      seniority = excluded.seniority, sponsor = excluded.sponsor, url = excluded.url, last_seen = excluded.last_seen,
      office_days = CASE WHEN excluded.body = '' THEN jobs.office_days ELSE excluded.office_days END,
      sponsorship = CASE WHEN excluded.body = '' THEN jobs.sponsorship ELSE excluded.sponsorship END,
      salary_min = COALESCE(excluded.salary_min, jobs.salary_min), salary_max = COALESCE(excluded.salary_max, jobs.salary_max),
      currency = COALESCE(excluded.currency, jobs.currency), salary_period = COALESCE(excluded.salary_period, jobs.salary_period)
  `);
  use().exec("BEGIN");
  try {
    for (const j of jobs) {
      upsert.run(
        j.id, j.source, j.company, j.title, j.location, j.workMode, j.officeDays, j.family, j.seniority, j.salaryMin, j.salaryMax, j.currency,
        j.salaryPeriod, Number(j.salaryPredicted), j.sponsorship, j.sponsor, j.url, j.postedAt, j.body, now, now, task, runId,
      );
    }
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// A listing is stored once, by its id (Rightmove's, or openrent:<OpenRent's>). Seen again, it gets the day and what the search says now;
// a new rent goes on the end of `prices` ([{ at, pcm }], oldest first), so a reduction shows. A page
// fetched this run fills `details`, and the postcode from it. A complete sweep is remembered in state
// (`swept:<task>`): the listings not seen since it have gone.
export function saveHomes(task: string, runId: string, file: HomesFile) {
  const now = new Date().toISOString();
  const before = use().prepare("SELECT price_pcm AS pcm, prices FROM homes WHERE id = ?");
  const upsert = use().prepare(`
    INSERT INTO homes (id, url, address, lat, lng, price_pcm, prices, beds, baths, type, agent, phone, image, summary, listed_at,
      available_from, first_seen, last_seen, task, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      url = excluded.url, address = excluded.address, lat = excluded.lat, lng = excluded.lng, price_pcm = excluded.price_pcm,
      prices = excluded.prices, beds = excluded.beds, baths = excluded.baths, type = excluded.type, agent = excluded.agent,
      phone = COALESCE(excluded.phone, homes.phone), image = COALESCE(excluded.image, homes.image), summary = excluded.summary,
      listed_at = excluded.listed_at, available_from = excluded.available_from, last_seen = excluded.last_seen
  `);
  const detail = use().prepare("UPDATE homes SET details = ?, postcode = ?, details_at = ? WHERE id = ?");
  use().exec("BEGIN");
  try {
    for (const h of file.listings) {
      const old = before.get(h.id) as { pcm: number; prices: string } | undefined;
      const prices: { at: string; pcm: number }[] = old ? JSON.parse(old.prices) : [];
      if (!old || old.pcm !== h.pricePcm) prices.push({ at: now, pcm: h.pricePcm });
      upsert.run(
        h.id, h.url, h.address, h.lat, h.lng, h.pricePcm, JSON.stringify(prices), h.beds, h.baths, h.type, h.agent, h.phone, h.image,
        h.summary, h.listedAt, h.availableFrom, now, now, task, runId,
      );
    }
    for (const [id, d] of Object.entries(file.details)) detail.run(JSON.stringify(d), d.postcode, now, id);
    if (file.sweptAt) setState(`swept:${task}`, file.sweptAt);
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// Columns added to homes after it was made. The commute (src/commute.ts): minutes to each of task.json's
// commute places, as JSON. What the model read from a listing (src/homes.ts): the EPC rating off its
// chart or out of its text, what the listing says on the things Rightmove cannot filter on, and its fit
// for the reader; the rating and the fit are columns, so they can be queried, the rest is `read` as JSON.
const HOME_COLUMNS = {
  commute: "TEXT",
  commute_at: "TEXT",
  // The crime around it (src/crime.ts), as JSON (CrimeNear); crime_at moves only when its level does.
  crime: "TEXT",
  crime_at: "TEXT",
  // Its certificate on the EPC register (src/epc.ts), as JSON (HomeCert), and when it was last looked for.
  cert: "TEXT",
  cert_at: "TEXT",
  epc_band: "TEXT",
  epc_score: "INTEGER",
  epc_from: "TEXT",
  fit: "INTEGER",
  fit_why: "TEXT",
  read: "TEXT",
  read_at: "TEXT",
  read_run: "TEXT",
  // The rent when it was read: a new rent changes the fit, so the listing is read again.
  read_pcm: "INTEGER",
  // The rent at which a Telegram message went out for the listing (src/homes.ts notifyHomes), and when.
  notified_pcm: "INTEGER",
  notified_at: "TEXT",
};
export type HomeRead = {
  /** A to G, or null when neither the chart nor the text gives it. */
  epcBand: string | null;
  /** The chart's Current number, 1 to 100; null when only a band is given. */
  epcScore: number | null;
  /** chart, text or unknown. */
  epcFrom: string;
  /** all, some, none or not said. */
  bills: string;
  billsWhat: string;
  /** yes, ask, no or not said. */
  pets: string;
  /** separate, open plan, none or not said. */
  livingRoom: string;
  /** private, shared, none or not said. */
  garden: string;
  /** gas, electric, storage heaters, heat pump, communal or not said. */
  heating: string;
  /** private (a driveway, garage, allocated or off-street space), on street, none or not said; absent from reads before 2026-11-08. */
  parking?: string;
  /** quiet (the listing says so: a quiet or residential street, a cul-de-sac), busy (a main road, above shops or bars) or not said; absent before 2026-11-08. */
  street?: string;
  /** Floor area in square metres when the listing gives one. */
  sqm: number | null;
  redFlags: string[];
  /** The model's fit, 1 to 5, from before the score out of 10 (src/score.ts) replaced it; null since. */
  fit: number | null;
  fitWhy: string;
};

// Minutes from a listing to each commute place by name (src/commute.ts): null when over 90, `via` the
// rides ("bus 68 + tram") for a place with a limit. A place not in it has not been timed.
export type Commute = Record<string, { min: number | null; via?: string }>;

// A street-level crime as the police publish it (src/crime.ts), and what is near a listing: the crimes
// within `metres` a year over `span` ("2025-10 to 2026-09"), in all and by police category, and their level.
export type Crime = { id: number; month: string; category: string; lat: number; lng: number; street: string };
export type CrimeNear = { perYear: number; level: string; by: Record<string, number>; span: string; metres: number };

// The months fetched for `area` (src/crime.ts), kept in state rather than read off the rows, so a month
// with no crimes in it still counts as fetched; a different area has none.
export function crimeMonths(area: string): string[] {
  return getState("crime-area") === area ? (JSON.parse(getState("crime-months") ?? "[]") as string[]) : [];
}

// A month's crimes, whole: what was kept for it is replaced in one go. The first month of a new area
// clears the old area's crimes.
export function saveCrimeMonth(area: string, month: string, crimes: Crime[]) {
  const insert = use().prepare("INSERT OR IGNORE INTO crimes (id, month, category, lat, lng, street) VALUES (?, ?, ?, ?, ?, ?)");
  use().exec("BEGIN");
  try {
    if (getState("crime-area") !== area) {
      use().exec("DELETE FROM crimes");
      setState("crime-area", area);
      setState("crime-months", "[]");
    }
    use().prepare("DELETE FROM crimes WHERE month = ?").run(month);
    for (const c of crimes) insert.run(c.id, c.month, c.category, c.lat, c.lng, c.street);
    setState("crime-months", JSON.stringify([...new Set([...crimeMonths(area), month])].sort()));
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

export function dropCrimeMonths(keep: string[]) {
  if (!keep.length) return;
  use().prepare(`DELETE FROM crimes WHERE month NOT IN (${keep.map(() => "?").join(",")})`).run(...keep);
  const months = JSON.parse(getState("crime-months") ?? "[]") as string[];
  setState("crime-months", JSON.stringify(months.filter((m) => keep.includes(m))));
}

export function loadCrimes(): { category: string; lat: number; lng: number }[] {
  return use().prepare("SELECT category, lat, lng FROM crimes").all() as { category: string; lat: number; lng: number }[];
}

// The listings still up with a location, and the crime they have now.
export function homesToScore(task: string): { id: string; lat: number; lng: number; crime: CrimeNear | null }[] {
  const swept = getState(`swept:${task}`) ?? "";
  const rows = use()
    .prepare("SELECT id, lat, lng, crime FROM homes WHERE task = ? AND lat IS NOT NULL AND lng IS NOT NULL AND last_seen >= ?")
    .all(task, swept) as { id: string; lat: number; lng: number; crime: string | null }[];
  return rows.map((r) => ({ ...r, crime: r.crime ? (JSON.parse(r.crime) as CrimeNear) : null }));
}

// `stamp`: the level changed (or is new, or gone), which has the listing read again for its fit. A
// listing outside the area fetched has no crime figure (null).
export function saveCrimes(changes: Map<string, { crime: CrimeNear | null; stamp: boolean }>) {
  const now = new Date().toISOString();
  const update = use().prepare("UPDATE homes SET crime = ?, crime_at = CASE WHEN ? THEN ? ELSE crime_at END WHERE id = ?");
  use().exec("BEGIN");
  try {
    for (const [id, { crime, stamp }] of changes) update.run(crime ? JSON.stringify(crime) : null, stamp ? 1 : 0, now, id);
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// A listing waiting for the model: the search's fields, its page and its commute.
// `bills`: what an earlier read said about the bills, for a listing read again.
export type UnreadHome = HomeListing & { postcode: string | null; details: HomeDetails; commute: Commute; crime: CrimeNear | null; cert: HomeCert | null; bills: string | null };

// A read made at another rent, or before the listing's commute times or crime level: both go into the
// fit, so it is read again (the old read shows until then).
const STALE = "(read_pcm IS NOT price_pcm OR commute_at > read_at OR crime_at > read_at)";

// The listings whose page has been fetched and that no read has seen, or whose rent, commute times or
// crime level changed since the read (both go into the fit), still up (seen in the last complete sweep or since), the
// likely ones first (1 to 3 bedrooms within `maxRent`), newest first. A re-read listing keeps its old
// read until the new one replaces it.
export function unreadHomes(task: string, maxRent: number): UnreadHome[] {
  const swept = getState(`swept:${task}`) ?? "";
  const rows = use()
    .prepare(`
      SELECT id, url, address, postcode, lat, lng, price_pcm AS pricePcm, beds, baths, type, agent, phone, image, summary,
        listed_at AS listedAt, available_from AS availableFrom, details, commute, crime, cert, json_extract(read, '$.bills') AS bills
      FROM homes WHERE task = ? AND details IS NOT NULL AND (read_at IS NULL OR ${STALE}) AND last_seen >= ?
      ORDER BY (price_pcm <= ? AND beds BETWEEN 1 AND 3) DESC, listed_at DESC, id
    `)
    .all(task, swept, maxRent) as unknown as (Omit<UnreadHome, "details" | "commute" | "crime" | "cert"> & { details: string; commute: string | null; crime: string | null; cert: string | null })[];
  return rows.map((r) => ({
    ...r,
    details: JSON.parse(r.details),
    commute: JSON.parse(r.commute ?? "{}"),
    crime: r.crime ? JSON.parse(r.crime) : null,
    cert: r.cert ? JSON.parse(r.cert) : null,
  }));
}

// The listings still up, with a location, that have not been timed to every one of `places` (names).
export function homesToTime(task: string, places: string[]): { id: string; lat: number; lng: number; commute: Commute }[] {
  const swept = getState(`swept:${task}`) ?? "";
  const rows = use()
    .prepare("SELECT id, lat, lng, commute FROM homes WHERE task = ? AND lat IS NOT NULL AND lng IS NOT NULL AND last_seen >= ?")
    .all(task, swept) as { id: string; lat: number; lng: number; commute: string | null }[];
  return rows.map((r) => ({ ...r, commute: JSON.parse(r.commute ?? "{}") as Commute })).filter((r) => places.some((p) => !(p in r.commute)));
}

export function markNotified(id: string, pcm: number) {
  use().prepare("UPDATE homes SET notified_pcm = ?, notified_at = ? WHERE id = ?").run(pcm, new Date().toISOString(), id);
}

export function saveCommutes(commutes: Map<string, Commute>) {
  const now = new Date().toISOString();
  const update = use().prepare("UPDATE homes SET commute = ?, commute_at = ? WHERE id = ?");
  use().exec("BEGIN");
  try {
    for (const [id, commute] of commutes) update.run(JSON.stringify(commute), now, id);
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// The EPC register (src/epc.ts). An entry is a certificate as a postcode search lists it; a certificate
// is what src/epc.ts keeps of one; a listing's HomeCert is the council its postcode is in and the
// certificate it was matched to, how (its house or flat number, its chart's band and score, or the only
// one at the postcode), and among how many alike (the one with the middle energy cost is kept).
export type EpcEntry = { number: string; address: string; uprn: string; band: string; registered: string; council: string };
// What src/epc.ts keeps of a certificate changed shape: a kept one older than this is fetched again, and a
// listing matched to one is looked up again.
export const CERT_VERSION = 2;
export type Certificate = {
  v?: number;
  number: string;
  address: string;
  registered: string;
  band: string;
  score: number | null;
  sqm: number | null;
  heating: string;
  hotWater: string;
  /** Heat a year for the rooms and for hot water, kWh, as the certificate models it. */
  spaceKwh: number | null;
  waterKwh: number | null;
};
export type HomeCert = { council: string | null; cert: Certificate | null; how: "address" | "score" | "only" | null; of: number };

export function epcPostcode(postcode: string): { fetchedAt: string; entries: EpcEntry[] } | null {
  const row = use().prepare("SELECT fetched_at AS fetchedAt, entries FROM epc_postcodes WHERE postcode = ?").get(postcode) as { fetchedAt: string; entries: string } | undefined;
  return row ? { fetchedAt: row.fetchedAt, entries: JSON.parse(row.entries) } : null;
}

export function saveEpcPostcode(postcode: string, entries: EpcEntry[]) {
  use()
    .prepare("INSERT INTO epc_postcodes (postcode, fetched_at, entries) VALUES (?, ?, ?) ON CONFLICT (postcode) DO UPDATE SET fetched_at = excluded.fetched_at, entries = excluded.entries")
    .run(postcode, new Date().toISOString(), JSON.stringify(entries));
}

export function epcCert(number: string): Certificate | null {
  const row = use().prepare("SELECT cert FROM epc_certs WHERE number = ?").get(number) as { cert: string } | undefined;
  return row ? JSON.parse(row.cert) : null;
}

export function saveEpcCert(cert: Certificate) {
  use().prepare("INSERT OR REPLACE INTO epc_certs (number, cert) VALUES (?, ?)").run(cert.number, JSON.stringify(cert));
}

// The listings still up with a postcode that have not been looked up on the register, were read since
// (the read's EPC score is what matches most of them), found nothing when last looked before
// `lookedBefore` (a certificate may have been made since), or were matched to an older kind of record.
// `sqm`: the floor area the agent gave or the read found.
export function homesToCertify(
  task: string,
  lookedBefore: string,
): { id: string; address: string; postcode: string; epcBand: string | null; epcScore: number | null; sqm: number | null; cert: HomeCert | null }[] {
  const swept = getState(`swept:${task}`) ?? "";
  const rows = use()
    .prepare(`
      SELECT id, address, postcode, epc_band AS epcBand, epc_score AS epcScore, cert,
        COALESCE(json_extract(details, '$.sqm'), NULLIF(json_extract(read, '$.sqm'), 0)) AS sqm
      FROM homes
      WHERE task = ? AND postcode IS NOT NULL AND last_seen >= ? AND (
        cert_at IS NULL OR read_at > cert_at
        OR (json_extract(cert, '$.cert') IS NULL AND cert_at < ?)
        OR (json_extract(cert, '$.cert') IS NOT NULL AND IFNULL(json_extract(cert, '$.cert.v'), 0) < ?)
      )
      ORDER BY listed_at DESC
    `)
    .all(task, swept, lookedBefore, CERT_VERSION) as { id: string; address: string; postcode: string; epcBand: string | null; epcScore: number | null; sqm: number | null; cert: string | null }[];
  return rows.map((r) => ({ ...r, cert: r.cert ? (JSON.parse(r.cert) as HomeCert) : null }));
}

export function saveHomeCert(id: string, cert: HomeCert) {
  use().prepare("UPDATE homes SET cert = ?, cert_at = ? WHERE id = ?").run(JSON.stringify(cert), new Date().toISOString(), id);
}

// A listing as the Homes page reads it. `up`: seen in the last complete sweep or since.
export type HomeRow = HomeListing & {
  postcode: string | null;
  details: HomeDetails | null;
  prices: { at: string; pcm: number }[];
  firstSeen: string;
  lastSeen: string;
  up: boolean;
  read: HomeRead | null;
  commute: Commute;
  /** The rent a message went out at, null when none has. */
  notifiedPcm: number | null;
  /** Read, but at another rent, or before its commute times or crime level: waiting to be read again. */
  stale: boolean;
  crime: CrimeNear | null;
  cert: HomeCert | null;
};

export function listHomes(task: string): HomeRow[] {
  const swept = getState(`swept:${task}`) ?? "";
  const rows = use()
    .prepare(`
      SELECT id, url, address, postcode, lat, lng, price_pcm AS pricePcm, prices, beds, baths, type, agent, phone, image, summary,
        listed_at AS listedAt, available_from AS availableFrom, details, first_seen AS firstSeen, last_seen AS lastSeen,
        epc_band, epc_score, epc_from, fit, fit_why, read, read_at, commute, notified_pcm AS notifiedPcm,
        (read_at IS NOT NULL AND ${STALE}) AS stale, crime, cert
      FROM homes WHERE task = ?
    `)
    .all(task) as unknown as (Omit<HomeRow, "details" | "prices" | "up" | "read" | "commute" | "crime" | "cert"> & {
    commute: string | null;
    crime: string | null;
    cert: string | null;
    details: string | null;
    prices: string;
    epc_band: string | null;
    epc_score: number | null;
    epc_from: string | null;
    fit: number | null;
    fit_why: string | null;
    read: string | null;
    read_at: string | null;
  })[];
  return rows.map(({ details, prices, epc_band, epc_score, epc_from, fit, fit_why, read, read_at, commute, crime, cert, ...r }) => ({
    ...r,
    commute: JSON.parse(commute ?? "{}"),
    crime: crime ? JSON.parse(crime) : null,
    cert: cert ? JSON.parse(cert) : null,
    stale: !!r.stale,
    details: details ? JSON.parse(details) : null,
    prices: JSON.parse(prices),
    up: r.lastSeen >= swept,
    read: read_at
      ? { ...JSON.parse(read ?? "{}"), epcBand: epc_band, epcScore: epc_score, epcFrom: epc_from ?? "unknown", fit, fitWhy: fit_why ?? "" }
      : null,
  }));
}

export function saveHomeReads(runId: string, reads: Map<string, HomeRead>) {
  const now = new Date().toISOString();
  const update = use().prepare(
    "UPDATE homes SET epc_band = ?, epc_score = ?, epc_from = ?, fit = ?, fit_why = ?, read = ?, read_at = ?, read_run = ?, read_pcm = price_pcm WHERE id = ?",
  );
  use().exec("BEGIN");
  try {
    for (const [id, { epcBand, epcScore, epcFrom, fit, fitWhy, ...rest }] of reads) {
      update.run(epcBand, epcScore, epcFrom, fit, fitWhy, JSON.stringify(rest), now, runId, id);
    }
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// What the model read from an advert's text (src/jobs.ts). The family and sponsorship as the text tells
// them sit beside code's own reading, which stays as it was.
const JOB_READ_COLUMNS = {
  text_family: "TEXT",
  skills: "TEXT",
  nice_skills: "TEXT",
  min_years: "INTEGER",
  text_sponsorship: "TEXT",
  ai_tools: "INTEGER",
  fit: "INTEGER",
  fit_why: "TEXT",
  read_at: "TEXT",
  read_run: "TEXT",
};
export type JobRead = {
  /** frontend, fullstack, backend, mobile, data, devops, or "not a developer" when the job is not writing software. */
  textFamily: string;
  skills: string[];
  niceSkills: string[];
  /** The fewest years of experience it asks for, 0 when it names none. */
  minYears: number;
  /** offered, not offered, right to work, or not said. */
  textSponsorship: string;
  /** It expects AI coding tools in the daily work. */
  aiTools: boolean;
  /** How well the reader (tasks/jobs-read/profile.md) fits the role, 1 to 5; null when the answer gave none. */
  fit: number | null;
  fitWhy: string;
};

// An advert as the Jobs page reads it: what code read from it and, once read, what the model did,
// without its body.
export type JobRow = Omit<NewJob, "body"> & { firstSeen: string; lastSeen: string; read: JobRead | null };
// Exported with toJobRow for scripts/job-market.ts, which reads the database read-only on its own.
export const JOB_COLUMNS = `id, source, company, title, location, work_mode AS workMode, office_days AS officeDays, family, seniority,
  salary_min AS salaryMin, salary_max AS salaryMax, currency, salary_period AS salaryPeriod, salary_predicted AS salaryPredicted,
  sponsorship, sponsor, url, posted_at AS postedAt, first_seen AS firstSeen, last_seen AS lastSeen,
  text_family, skills, nice_skills, min_years, text_sponsorship, ai_tools, fit, fit_why, read_at`;

export type JobDbRow = Omit<JobRow, "read" | "salaryPredicted"> & {
  salaryPredicted: number;
  text_family: string | null;
  skills: string | null;
  nice_skills: string | null;
  min_years: number | null;
  text_sponsorship: string | null;
  ai_tools: number | null;
  fit: number | null;
  fit_why: string | null;
  read_at: string | null;
};
export function toJobRow({ text_family, skills, nice_skills, min_years, text_sponsorship, ai_tools, fit, fit_why, read_at, ...j }: JobDbRow): JobRow {
  return {
    ...j,
    salaryPredicted: Boolean(j.salaryPredicted),
    read: read_at
      ? {
          textFamily: text_family ?? "",
          skills: JSON.parse(skills ?? "[]"),
          niceSkills: JSON.parse(nice_skills ?? "[]"),
          minYears: min_years ?? 0,
          textSponsorship: text_sponsorship ?? "not said",
          aiTools: Boolean(ai_tools),
          fit,
          fitWhy: fit_why ?? "",
        }
      : null,
  };
}

// The newest collection, and the time from which an advert still counts as open: within a day and a
// half of it, so a source that failed one run does not close all its adverts.
function openSince(): string | null {
  const newest = (use().prepare("SELECT MAX(last_seen) AS t FROM jobs").get() as { t: string | null }).t;
  return newest && new Date(Date.parse(newest) - 36 * 3_600_000).toISOString();
}

// The adverts still open.
export function openJobs(): JobRow[] {
  const since = openSince();
  if (!since) return [];
  return (use().prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE last_seen >= ? ORDER BY first_seen DESC`).all(since) as unknown as JobDbRow[]).map(toJobRow);
}

// Every advert first seen since a time, open or closed, for the weekly counts.
export function jobsSince(since: string): JobRow[] {
  return (use().prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE first_seen >= ?`).all(since) as unknown as JobDbRow[]).map(toJobRow);
}

// An advert waiting for the model to read it, with its text.
export type UnreadJob = { id: string; company: string; title: string; location: string; body: string };

// The open adverts with a text that no read has seen, newest first.
export function unreadJobs(): UnreadJob[] {
  const since = openSince();
  if (!since) return [];
  return use()
    .prepare("SELECT id, company, title, location, body FROM jobs WHERE read_at IS NULL AND body != '' AND last_seen >= ? ORDER BY first_seen DESC, id")
    .all(since) as unknown as UnreadJob[];
}

// Every stored text of these companies' adverts, open or closed, to find what they all share.
export function companyBodies(companies: string[]): { company: string; body: string }[] {
  if (!companies.length) return [];
  return use()
    .prepare(`SELECT company, body FROM jobs WHERE body != '' AND company IN (${companies.map(() => "?").join(", ")})`)
    .all(...companies) as { company: string; body: string }[];
}

export function saveJobReads(runId: string, reads: Map<string, JobRead>) {
  const now = new Date().toISOString();
  const update = use().prepare(`
    UPDATE jobs SET text_family = ?, skills = ?, nice_skills = ?, min_years = ?, text_sponsorship = ?, ai_tools = ?, fit = ?, fit_why = ?, read_at = ?, read_run = ?
    WHERE id = ?
  `);
  use().exec("BEGIN");
  try {
    for (const [id, r] of reads) {
      update.run(r.textFamily, JSON.stringify(r.skills), JSON.stringify(r.niceSkills), r.minYears, r.textSponsorship, Number(r.aiTools), r.fit, r.fitWhy, now, runId, id);
    }
    use().exec("COMMIT");
  } catch (err) {
    use().exec("ROLLBACK");
    throw err;
  }
}

// When the first collection ran, which the weekly counts need: that week holds every advert open then.
export function firstJobSeen(): string | null {
  return (use().prepare("SELECT MIN(first_seen) AS t FROM jobs").get() as { t: string | null }).t;
}

// A post's columns as PostRow names them, from `posts p`.
const POST_COLUMNS = "p.id, p.source, p.community, p.author, p.posted_at AS postedAt, p.title, p.body, p.url, p.budget, p.kind";

// A radar's kept posts no sort has seen yet, newest first, and how many there are in all. A post is the
// radar's that collected it (posts.task).
export function unsortedPosts(task: string, limit: number): { posts: PostRow[]; total: number } {
  const from = "FROM posts p LEFT JOIN mentions m ON m.post_id = p.id WHERE p.task = ? AND p.kept = 1 AND m.post_id IS NULL";
  const posts = use().prepare(`SELECT ${POST_COLUMNS} ${from} ORDER BY p.posted_at DESC LIMIT ?`).all(task, limit) as PostRow[];
  const { total } = use().prepare(`SELECT COUNT(*) AS total ${from}`).get(task) as { total: number };
  return { posts, total };
}

// Every problem a post can still go to (not merged away), oldest first.
const PROBLEM_COLUMNS = "id, task, name, category, summary, status, merged_into AS mergedInto, created_at AS createdAt, judge_asked AS judgeAsked";

export function listProblems(task: string): ProblemRow[] {
  return use().prepare(`SELECT ${PROBLEM_COLUMNS} FROM problems WHERE task = ? AND status != 'merged' ORDER BY id`).all(task) as ProblemRow[];
}

export function getProblem(id: number): ProblemRow | null {
  return (use().prepare(`SELECT ${PROBLEM_COLUMNS} FROM problems WHERE id = ?`).get(id) as ProblemRow | undefined) ?? null;
}

export function setProblemStatus(id: number, status: "open" | "starred" | "killed") {
  use().prepare("UPDATE problems SET status = ? WHERE id = ? AND status != 'merged'").run(status, id);
}

// Judge again: the judge run takes asked problems first, whatever their evidence.
export function askJudge(id: number, asked = true) {
  use().prepare("UPDATE problems SET judge_asked = ? WHERE id = ?").run(asked ? new Date().toISOString() : null, id);
}

// Two problems that are one: `from`'s mentions move to `into`, and `from` stays as merged, so a sort
// that still names it is pointed on (saveSort follows merged_into).
export function mergeProblem(from: number, into: number) {
  const db = use();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE mentions SET problem_id = ? WHERE problem_id = ?").run(into, from);
    db.prepare("UPDATE problems SET status = 'merged', merged_into = ? WHERE id = ?").run(into, from);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

type VerdictDbRow = Omit<VerdictRow, "scores" | "competitors"> & { scores: string; competitors: string };
const VERDICT_COLUMNS = "id, problem_id AS problemId, verdict, hard_no AS hardNo, scores, competitors, size, reason, test, mentions, created_at AS createdAt";
const toVerdict = (r: VerdictDbRow): VerdictRow => ({ ...r, scores: JSON.parse(r.scores), competitors: JSON.parse(r.competitors) });

// Every problem's newest verdict.
export function latestVerdicts(): Map<number, VerdictRow> {
  const rows = use().prepare(`SELECT ${VERDICT_COLUMNS} FROM verdicts WHERE id IN (SELECT MAX(id) FROM verdicts GROUP BY problem_id)`).all() as VerdictDbRow[];
  return new Map(rows.map((r) => [r.problemId, toVerdict(r)]));
}

// A problem's verdicts, newest first.
export function problemVerdicts(problemId: number): VerdictRow[] {
  return (use().prepare(`SELECT ${VERDICT_COLUMNS} FROM verdicts WHERE problem_id = ? ORDER BY id DESC`).all(problemId) as VerdictDbRow[]).map(toVerdict);
}

export function saveVerdicts(runId: string, verdicts: Omit<VerdictRow, "id" | "createdAt">[]) {
  const db = use();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const add = db.prepare(`
      INSERT INTO verdicts (problem_id, verdict, hard_no, scores, competitors, size, reason, test, mentions, created_at, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of verdicts) {
      add.run(v.problemId, v.verdict, v.hardNo, JSON.stringify(v.scores), JSON.stringify(v.competitors), v.size, v.reason, v.test, v.mentions, now, runId);
      db.prepare("UPDATE problems SET judge_asked = NULL WHERE id = ?").run(v.problemId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// One sort's result, all or nothing: the problems it opened, then every post's mention. A mention's
// `problemId` below zero points at the new problem of that index (-1 the first).
export function saveSort(task: string, runId: string, opened: { name: string; category: string; summary: string }[], found: Mention[]): number[] {
  const db = use();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const add = db.prepare("INSERT INTO problems (task, name, category, summary, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?)");
    const ids = opened.map((p) => Number(add.run(task, p.name, p.category, p.summary, now, runId).lastInsertRowid));
    const put = db.prepare(`
      INSERT OR REPLACE INTO mentions (post_id, problem_id, recurring, cost, workaround, quote, note, run_id, sorted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const merged = new Map((db.prepare("SELECT id, merged_into AS target FROM problems WHERE status = 'merged'").all() as { id: number; target: number }[]).map((r) => [r.id, r.target]));
    const follow = (id: number) => {
      for (let i = 0; i < 10 && merged.has(id); i++) id = merged.get(id)!;
      return id;
    };
    for (const m of found) {
      const problem = m.problemId !== null && m.problemId < 0 ? ids[-m.problemId - 1] : m.problemId === null ? null : follow(m.problemId);
      put.run(m.postId, problem ?? null, Number(m.recurring), m.cost, m.workaround, m.quote, m.note ?? null, runId, now);
    }
    db.exec("COMMIT");
    return ids;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Every mention of a problem with its post, newest first.
export function problemMentions(problemId: number): (Mention & { post: PostRow })[] {
  const rows = use().prepare(`
    SELECT m.post_id AS postId, m.problem_id AS problemId, m.recurring, m.cost, m.workaround, m.quote, m.note, ${POST_COLUMNS}
    FROM mentions m JOIN posts p ON p.id = m.post_id WHERE m.problem_id = ? ORDER BY p.posted_at DESC
  `).all(problemId) as (Record<string, unknown>)[];
  return rows.map((r) => ({
    postId: r.postId as string,
    problemId: r.problemId as number,
    recurring: r.recurring === 1,
    cost: r.cost as string,
    workaround: r.workaround as string,
    quote: r.quote as string,
    post: { id: r.id, source: r.source, community: r.community, author: r.author, postedAt: r.postedAt, title: r.title, body: r.body, url: r.url, budget: r.budget, kind: r.kind } as PostRow,
  }));
}

// What a radar counts, per problem with at least one mention: one row per mention, with the facts
// about its post that the counts need. The counting is in src/ideas.ts.
export function mentionFacts(task: string): { problemId: number; postId: string; source: string; community: string; author: string; title: string; postedAt: string; budget: string | null; recurring: number; cost: string; workaround: string }[] {
  return use().prepare(`
    SELECT m.problem_id AS problemId, p.id AS postId, p.source, p.community, p.author, p.title, p.posted_at AS postedAt, p.budget, m.recurring, m.cost, m.workaround
    FROM mentions m JOIN posts p ON p.id = m.post_id JOIN problems pr ON pr.id = m.problem_id WHERE pr.task = ?
  `).all(task) as ReturnType<typeof mentionFacts>;
}

// How far a radar's sort has got: posts kept, sorted, raising a problem, and problems.
export function radarTotals(task: string): { posts: number; sorted: number; raising: number; problems: number } {
  return use().prepare(`
    SELECT (SELECT COUNT(*) FROM posts WHERE task = ? AND kept = 1) AS posts,
           (SELECT COUNT(*) FROM mentions m JOIN posts p ON p.id = m.post_id WHERE p.task = ?) AS sorted,
           (SELECT COUNT(*) FROM mentions m JOIN posts p ON p.id = m.post_id WHERE p.task = ? AND m.problem_id IS NOT NULL) AS raising,
           (SELECT COUNT(*) FROM problems WHERE task = ? AND status != 'merged') AS problems
  `).get(task, task, task, task) as { posts: number; sorted: number; raising: number; problems: number };
}

// A radar's overview (src/ideas.ts): the whole board summed up, and per category what one person could
// build from it. `input_hash` is the hash of what the model was given, so a run with nothing new skips it.
export type OverviewIdea = { name: string; pitch: string; why: string; risk: string; first: string; problems: number[]; best: boolean };
export type OverviewCategory = { category: string; take: string; summary: string; ideas: OverviewIdea[] };
export type OverviewRow = { id: number; summary: string; categories: OverviewCategory[]; inputHash: string; createdAt: string };

export function saveOverview(task: string, runId: string, overview: Omit<OverviewRow, "id" | "createdAt">): number {
  return Number(
    use()
      .prepare("INSERT INTO overviews (task, summary, categories, input_hash, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(task, overview.summary, JSON.stringify(overview.categories), overview.inputHash, new Date().toISOString(), runId).lastInsertRowid,
  );
}

// A radar's newest overview, or null before its first.
export function latestOverview(task: string): OverviewRow | null {
  const row = use().prepare("SELECT id, summary, categories, input_hash AS inputHash, created_at AS createdAt FROM overviews WHERE task = ? ORDER BY id DESC LIMIT 1").get(task) as
    | (Omit<OverviewRow, "categories"> & { categories: string })
    | undefined;
  return row ? { ...row, categories: JSON.parse(row.categories) } : null;
}

// The newest issues, of one newsletter or all of them, without their text.
export function listIssues(feed?: string, limit = 100): IssueRow[] {
  const where = feed === undefined ? "" : "WHERE feed = ?";
  const rows = use().prepare(`SELECT id, feed, title, url, date FROM issues ${where} ORDER BY date DESC, id DESC LIMIT ?`).all(...(feed === undefined ? [] : [feed]), limit);
  return rows as IssueRow[];
}

export function getIssue(id: number): (IssueRow & { html: string }) | null {
  return (use().prepare("SELECT id, feed, title, url, date, html FROM issues WHERE id = ?").get(id) as (IssueRow & { html: string }) | undefined) ?? null;
}

// Each newsletter with its number of issues and its newest one's date.
export function issueFeeds(): { feed: string; count: number; last: string }[] {
  return use().prepare("SELECT feed, COUNT(*) AS count, MAX(date) AS last FROM issues GROUP BY feed").all() as { feed: string; count: number; last: string }[];
}

// Runs made before the database existed (or restored from a volume) are picked up from their
// meta.json; rows already present are left alone, so this is cheap to run at every start.
// Tasks that were renamed: their run directories and rows move to the new name on start, so the tab
// keeps its history and previous.ts its memory. The directory is the name that counts (importRuns
// reads it, not the task in meta.json). When both folders exist (a checkout that had runs under both
// names), each run moves on its own, a run already under the new name keeps that one, and importRuns
// never reads the old folder: it used to import the old folder's runs again on every start, and the
// rename after that hit runs' key on the rows already moved and stopped the server starting.
const RENAMED: Record<string, string> = { haberler: "news" };

function renameTasks(runsDir: string) {
  for (const [from, to] of Object.entries(RENAMED)) {
    const old = join(runsDir, from);
    const now = join(runsDir, to);
    if (existsSync(old) && !existsSync(now)) renameSync(old, now);
    else if (existsSync(old)) for (const run of readdirSync(old)) if (!existsSync(join(now, run))) renameSync(join(old, run), join(now, run));
    use().prepare("UPDATE OR IGNORE runs SET task = ? WHERE task = ?").run(to, from);
    // What is left under the old name is a run the new name has too.
    use().prepare("DELETE FROM runs WHERE task = ?").run(from);
  }
}

// Never-show lists that went to another task: pains' to the ideas radar that replaced it. Copied once
// (a state key remembers it), so a phrase undone on the new task later stays undone.
const MUTES_MOVED: Record<string, string> = { pains: "ideas" };

function moveMutes() {
  for (const [from, to] of Object.entries(MUTES_MOVED)) {
    const key = `mutes_moved_${from}`;
    if (getState(key)) continue;
    use().prepare("INSERT OR IGNORE INTO mutes (task, phrase, created_at) SELECT ?, phrase, created_at FROM mutes WHERE task = ?").run(to, from);
    setState(key, new Date().toISOString());
  }
}

function importRuns(runsDir: string) {
  const has = use().prepare("SELECT 1 FROM runs WHERE task = ? AND run_id = ?");
  const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
  for (const task of readdirSync(runsDir, { withFileTypes: true })) {
    if (!task.isDirectory() || Object.hasOwn(RENAMED, task.name)) continue;
    for (const runId of readdirSync(join(runsDir, task.name))) {
      if (has.get(task.name, runId)) continue;
      const dir = join(runsDir, task.name, runId);
      const metaText = read(join(dir, "meta.json"));
      if (!metaText) continue;
      const imagesText = read(join(dir, "images.json"));
      const paperText = read(join(dir, "output.json"));
      saveRun({ ...JSON.parse(metaText), task: task.name }, read(join(dir, "output.md")), imagesText ? JSON.parse(imagesText) : {}, paperText ? JSON.parse(paperText) : null);
    }
  }
}

// A run still marked running when the server starts was cut off: a deploy or restart replaces the
// container and every process in it. Close those rows as failed so they stop looking alive. A CLI run
// going at the same moment (only possible locally) is marked too, and put right when it saves its end.
// finished_at stays empty: every other way a run ends sets it, so a failed run without one is a run a
// restart cut off, which the scheduler gives one retry.
export function closeStaleRuns(): number {
  return Number(use().prepare("UPDATE runs SET status = 'failed' WHERE status = 'running'").run().changes);
}
