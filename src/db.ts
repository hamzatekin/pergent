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
  `);
  // Added after the first deployments; a database from before gets the column on start.
  const columns = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "paper")) db.exec("ALTER TABLE runs ADD COLUMN paper TEXT");
  renameTasks(runsDir);
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
