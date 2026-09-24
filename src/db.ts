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

export function lastRunStartedAt(task: string): string | null {
  const row = use().prepare("SELECT MAX(started_at) AS at FROM runs WHERE task = ?").get(task) as { at: string | null };
  return row.at;
}

// A few named values, e.g. last_read: when the UI last fetched a run, which gates the scheduler.
export function getState(key: string): string | null {
  const row = use().prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string) {
  use().prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
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
export function closeStaleRuns(): number {
  return Number(use().prepare("UPDATE runs SET status = 'failed' WHERE status = 'running'").run().changes);
}
