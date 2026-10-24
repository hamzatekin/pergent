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
// A problem of the ideas radar (src/ideas.ts): what several posts complain about, named in the owners'
// words. `status` is open, starred, killed (hidden, its posts still land on it) or merged (into
// `merged_into`, which has its mentions now). `judgeAsked` is set by the page's Judge again.
export type ProblemRow = { id: number; name: string; category: string; summary: string; status: string; mergedInto: number | null; createdAt: string; judgeAsked: string | null };
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
    CREATE TABLE IF NOT EXISTS briefs (
      id         INTEGER PRIMARY KEY,
      since      TEXT NOT NULL,
      summary    TEXT NOT NULL,
      items      TEXT NOT NULL,
      next       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      run_id     TEXT NOT NULL
    );
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
  `);
  // Added after the first deployments; a database from before gets the column on start.
  const columns = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "paper")) db.exec("ALTER TABLE runs ADD COLUMN paper TEXT");
  const problemColumns = db.prepare("PRAGMA table_info(problems)").all() as { name: string }[];
  if (!problemColumns.some((c) => c.name === "judge_asked")) db.exec("ALTER TABLE problems ADD COLUMN judge_asked TEXT");
  // What the model read from an advert's text (src/jobs.ts), on the advert's row; read_at is empty until then.
  const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  for (const [name, type] of Object.entries(JOB_READ_COLUMNS)) {
    if (!jobColumns.some((c) => c.name === name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  }
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

// What the model read from an advert's text (src/jobs.ts). The family and sponsorship as the text tells
// them sit beside code's own reading, which stays as it was.
const JOB_READ_COLUMNS = {
  text_family: "TEXT",
  skills: "TEXT",
  nice_skills: "TEXT",
  min_years: "INTEGER",
  text_sponsorship: "TEXT",
  ai_tools: "INTEGER",
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
};

// An advert as the Jobs page reads it: what code read from it and, once read, what the model did,
// without its body.
export type JobRow = Omit<NewJob, "body"> & { firstSeen: string; lastSeen: string; read: JobRead | null };
const JOB_COLUMNS = `id, source, company, title, location, work_mode AS workMode, office_days AS officeDays, family, seniority,
  salary_min AS salaryMin, salary_max AS salaryMax, currency, salary_period AS salaryPeriod, salary_predicted AS salaryPredicted,
  sponsorship, sponsor, url, posted_at AS postedAt, first_seen AS firstSeen, last_seen AS lastSeen,
  text_family, skills, nice_skills, min_years, text_sponsorship, ai_tools, read_at`;

type JobDbRow = Omit<JobRow, "read" | "salaryPredicted"> & {
  salaryPredicted: number;
  text_family: string | null;
  skills: string | null;
  nice_skills: string | null;
  min_years: number | null;
  text_sponsorship: string | null;
  ai_tools: number | null;
  read_at: string | null;
};
function toJobRow({ text_family, skills, nice_skills, min_years, text_sponsorship, ai_tools, read_at, ...j }: JobDbRow): JobRow {
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
    UPDATE jobs SET text_family = ?, skills = ?, nice_skills = ?, min_years = ?, text_sponsorship = ?, ai_tools = ?, read_at = ?, read_run = ?
    WHERE id = ?
  `);
  use().exec("BEGIN");
  try {
    for (const [id, r] of reads) {
      update.run(r.textFamily, JSON.stringify(r.skills), JSON.stringify(r.niceSkills), r.minYears, r.textSponsorship, Number(r.aiTools), now, runId, id);
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

// The kept posts no sort has seen yet, newest first, and how many there are in all.
export function unsortedPosts(limit: number): { posts: PostRow[]; total: number } {
  const from = "FROM posts p LEFT JOIN mentions m ON m.post_id = p.id WHERE p.kept = 1 AND m.post_id IS NULL";
  const posts = use().prepare(`SELECT ${POST_COLUMNS} ${from} ORDER BY p.posted_at DESC LIMIT ?`).all(limit) as PostRow[];
  const { total } = use().prepare(`SELECT COUNT(*) AS total ${from}`).get() as { total: number };
  return { posts, total };
}

// Every problem a post can still go to (not merged away), oldest first.
const PROBLEM_COLUMNS = "id, name, category, summary, status, merged_into AS mergedInto, created_at AS createdAt, judge_asked AS judgeAsked";

export function listProblems(): ProblemRow[] {
  return use().prepare(`SELECT ${PROBLEM_COLUMNS} FROM problems WHERE status != 'merged' ORDER BY id`).all() as ProblemRow[];
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
export function saveSort(runId: string, opened: { name: string; category: string; summary: string }[], found: Mention[]): number[] {
  const db = use();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const add = db.prepare("INSERT INTO problems (name, category, summary, created_at, run_id) VALUES (?, ?, ?, ?, ?)");
    const ids = opened.map((p) => Number(add.run(p.name, p.category, p.summary, now, runId).lastInsertRowid));
    const put = db.prepare(`
      INSERT OR REPLACE INTO mentions (post_id, problem_id, recurring, cost, workaround, quote, note, run_id, sorted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const merged = new Map((db.prepare("SELECT id, merged_into AS into FROM problems WHERE status = 'merged'").all() as { id: number; into: number }[]).map((r) => [r.id, r.into]));
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

// What the radar counts, per problem with at least one mention: one row per mention, with the facts
// about its post that the counts need. The counting is in src/ideas.ts.
export function mentionFacts(): { problemId: number; postId: string; source: string; community: string; author: string; title: string; postedAt: string; budget: string | null; recurring: number; cost: string; workaround: string }[] {
  return use().prepare(`
    SELECT m.problem_id AS problemId, p.id AS postId, p.source, p.community, p.author, p.title, p.posted_at AS postedAt, p.budget, m.recurring, m.cost, m.workaround
    FROM mentions m JOIN posts p ON p.id = m.post_id WHERE m.problem_id IS NOT NULL
  `).all() as ReturnType<typeof mentionFacts>;
}

// How far the sort has got: posts kept, sorted, raising a problem, and problems.
export function radarTotals(): { posts: number; sorted: number; raising: number; problems: number } {
  return use().prepare(`
    SELECT (SELECT COUNT(*) FROM posts WHERE kept = 1) AS posts,
           (SELECT COUNT(*) FROM mentions) AS sorted,
           (SELECT COUNT(*) FROM mentions WHERE problem_id IS NOT NULL) AS raising,
           (SELECT COUNT(*) FROM problems WHERE status != 'merged') AS problems
  `).get() as { posts: number; sorted: number; raising: number; problems: number };
}

// The radar's on-demand brief (src/ideas.ts): what changed since `since`, in a few grouped lines that
// point at problems.
export type BriefItem = { group: string; problem: number; text: string };
export type BriefRow = { id: number; since: string; summary: string; items: BriefItem[]; next: string; createdAt: string };

export function saveBrief(runId: string, brief: Omit<BriefRow, "id" | "createdAt">): number {
  return Number(
    use()
      .prepare("INSERT INTO briefs (since, summary, items, next, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(brief.since, brief.summary, JSON.stringify(brief.items), brief.next, new Date().toISOString(), runId).lastInsertRowid,
  );
}

// The briefs, newest first.
export function listBriefs(limit = 50): BriefRow[] {
  const rows = use().prepare("SELECT id, since, summary, items, next, created_at AS createdAt FROM briefs ORDER BY id DESC LIMIT ?").all(limit) as (Omit<BriefRow, "items"> & { items: string })[];
  return rows.map((r) => ({ ...r, items: JSON.parse(r.items) }));
}

// What the radar did since a time: posts collected (by the run that saved them, whose id is its start
// time), posts sorted, and of those, how many raised a problem.
export function radarSince(since: string): { collected: number; sorted: number; raising: number } {
  const runId = since.replace(/[:.]/g, "-");
  return use().prepare(`
    SELECT (SELECT COUNT(*) FROM posts WHERE kept = 1 AND run_id >= ?) AS collected,
           (SELECT COUNT(*) FROM mentions WHERE sorted_at >= ?) AS sorted,
           (SELECT COUNT(*) FROM mentions WHERE sorted_at >= ? AND problem_id IS NOT NULL) AS raising
  `).get(runId, since, since) as { collected: number; sorted: number; raising: number };
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
// reads it, not the task in meta.json).
const RENAMED: Record<string, string> = { haberler: "news" };

function renameTasks(runsDir: string) {
  for (const [from, to] of Object.entries(RENAMED)) {
    if (existsSync(join(runsDir, from)) && !existsSync(join(runsDir, to))) renameSync(join(runsDir, from), join(runsDir, to));
    use().prepare("UPDATE runs SET task = ? WHERE task = ?").run(to, from);
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
    if (!task.isDirectory()) continue;
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
