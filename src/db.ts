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
// words. `status` is open, or merged (into `merged_into`); the page's Star and Kill come later.
export type ProblemRow = { id: number; name: string; category: string; summary: string; status: string; createdAt: string };
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
  `);
  // Added after the first deployments; a database from before gets the column on start.
  const columns = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "paper")) db.exec("ALTER TABLE runs ADD COLUMN paper TEXT");
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
export function listProblems(): ProblemRow[] {
  return use().prepare("SELECT id, name, category, summary, status, created_at AS createdAt FROM problems WHERE status != 'merged' ORDER BY id").all() as ProblemRow[];
}

export function getProblem(id: number): ProblemRow | null {
  return (use().prepare("SELECT id, name, category, summary, status, created_at AS createdAt FROM problems WHERE id = ?").get(id) as ProblemRow | undefined) ?? null;
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
    for (const m of found) {
      const problem = m.problemId !== null && m.problemId < 0 ? ids[-m.problemId - 1] : m.problemId;
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
