import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { getRun, openDb, saveRun, listRuns as listRunRows } from "./db.ts";
import { PAPER_SCHEMA, fromMarkdown, parsePaper, toMarkdown, type Paper } from "./paper.ts";
import { ratePaper } from "./rate.ts";

const ROOT = resolve(import.meta.dirname, "..");
const TASKS_DIR = join(ROOT, "tasks");
const RUNS_DIR = join(ROOT, "runs");
await mkdir(RUNS_DIR, { recursive: true });
openDb(RUNS_DIR);

export type TaskConfig = {
  schedule?: string;
  timezone?: string; // IANA zone the schedule is read in; defaults to the process TZ
  model?: string;
  allowedTools?: string[];
  timeoutMinutes?: number;
  /** Shell command run in the run directory before claude starts. Gets TASK_DIR in its env. */
  before?: string;
  /** How the reading view shows the task: the tab's text, the html lang, the background aside's handle, the briefs' heading. */
  label?: string;
  lang?: string;
  contextLabel?: string;
  briefsLabel?: string;
  /** false turns off Jev's per-story rating (src/rate.ts), which otherwise runs whenever TYPESAFE_API_KEY is set. */
  rate?: boolean;
  /** Output token cap for one claude reply (CLAUDE_CODE_MAX_OUTPUT_TOKENS); the whole paper is one reply. */
  maxOutputTokens?: number;
  [extra: string]: unknown;
};

export type RunMeta = {
  task: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "failed";
  exitCode?: number | null;
  timedOut?: boolean;
  costUsd?: number;
  turns?: number;
};

export type Task = { name: string; config: TaskConfig; prompt: string };

export async function listTasks(): Promise<string[]> {
  const entries = await readdir(TASKS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function loadTask(name: string): Promise<Task> {
  const dir = join(TASKS_DIR, name);
  const config: TaskConfig = JSON.parse(await readFile(join(dir, "task.json"), "utf8"));
  const prompt = await readFile(join(dir, "prompt.md"), "utf8");
  return { name, config, prompt };
}

// Where a run's files live: the log, stderr, before.log and the fetched inputs.
export function runDir(name: string, runId: string): string {
  return join(RUNS_DIR, name, runId);
}

export function listRuns(name: string): RunMeta[] {
  return listRunRows(name);
}

// What the reading view needs: the paper, and the lead images the before scripts found (images.json,
// article link -> image URL). Runs from before structured output are parsed out of their markdown.
// The log and stderr stay on disk.
export function readRun(name: string, runId: string): { meta: RunMeta; output: string; images: Record<string, string>; paper: Paper } | null {
  const row = getRun(name, runId);
  return row && { ...row, paper: row.paper ?? fromMarkdown(row.output) };
}

// A before command gets this long; the fetches inside it have their own, shorter timeouts.
const BEFORE_TIMEOUT_MS = 5 * 60_000;
// How long a child gets to exit after SIGTERM before it is killed outright.
const KILL_GRACE_MS = 30_000;

// Children are spawned detached, each the leader of its own process group, and stopped as a group:
// SIGTERM, then SIGKILL after the grace period. Killing only the child is not enough: a process it
// started (a `sh -c "a && b"` script, a tool claude ran) can outlive it holding the output pipe open,
// and the run then waits on that pipe forever, stuck at "running".
const live = new Set<ChildProcess>();
function signalGroup(child: ChildProcess, sig: NodeJS.Signals) {
  try {
    if (child.pid) process.kill(-child.pid, sig);
  } catch {
    // already gone
  }
}
function track<T extends ChildProcess>(child: T): T {
  live.add(child);
  child.once("exit", () => live.delete(child));
  return child;
}
// Detached groups do not get the terminal's hangup, so when this process is told to stop (the CLI's
// terminal closes, the container stops) it takes the groups down with it.
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.once(sig, () => {
    for (const child of live) signalGroup(child, "SIGKILL");
    process.exit(code);
  });
}

function stop(child: ChildProcess) {
  const signal = (sig: NodeJS.Signals) => signalGroup(child, sig);
  signal("SIGTERM");
  const kill = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
  kill.unref();
  child.once("close", () => clearTimeout(kill));
}

function runBefore(command: string, cwd: string, taskDir: string): Promise<boolean> {
  return new Promise((done) => {
    const child = track(spawn("sh", ["-c", command], { cwd, env: { ...process.env, TASK_DIR: taskDir }, stdio: ["ignore", "pipe", "pipe"], detached: true }));
    const log = createWriteStream(join(cwd, "before.log"));
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    const timer = setTimeout(() => {
      log.write(`\ntimed out after ${BEFORE_TIMEOUT_MS / 60_000} minutes\n`);
      stop(child);
    }, BEFORE_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

export async function runTask(name: string): Promise<{ meta: RunMeta; dir: string }> {
  const { config, prompt } = await loadTask(name);
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const dir = runDir(name, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "prompt.md"), prompt);
  const running: RunMeta = { task: name, runId, startedAt: startedAt.toISOString(), status: "running" };
  await writeFile(join(dir, "meta.json"), JSON.stringify(running, null, 2));
  saveRun(running);

  if (config.before) {
    const ok = await runBefore(config.before, dir, join(TASKS_DIR, name));
    if (!ok) {
      const meta: RunMeta = { ...running, finishedAt: new Date().toISOString(), status: "failed" };
      await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
      await writeFile(join(dir, "output.md"), "");
      saveRun(meta);
      return { meta, dir };
    }
  }

  // strict-mcp-config: ignore the user-level MCP servers; a task gets only what its own config names.
  // json-schema: the paper comes back as structured output, held to the schema on the model's side.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--json-schema", JSON.stringify(PAPER_SCHEMA)];
  if (config.model) args.push("--model", config.model);
  // --tools is what the model gets to see; --allowedTools only pre-approves, and on its own leaves the
  // rest of the built-in set (Bash, Edit, ...) available wherever settings let them through.
  if (config.allowedTools?.length) args.push("--tools", config.allowedTools.join(","), "--allowedTools", config.allowedTools.join(","));

  // No API key in the child env, so claude falls back to the subscription login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  // The paper is one StructuredOutput call, and a reply past claude's output cap (32k tokens by
  // default) is cut off mid-JSON and arrives as an empty object; a long Turkish paper got there.
  if (config.maxOutputTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(config.maxOutputTokens);

  const child = track(spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], detached: true }));
  child.stdin.end(prompt);
  child.stderr.pipe(createWriteStream(join(dir, "stderr.log")));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop(child);
  }, (config.timeoutMinutes ?? 15) * 60_000);

  const log = createWriteStream(join(dir, "log.jsonl"));
  let result: { result?: string; structured_output?: unknown; is_error?: boolean; total_cost_usd?: number; num_turns?: number } | undefined;
  const spawnedAt = Date.now();
  for await (const line of createInterface({ input: child.stdout })) {
    // Each event gets `t`, seconds since claude started, so the dashboard can show where the time went.
    const t = ((Date.now() - spawnedAt) / 1000).toFixed(1);
    log.write((line.startsWith("{") ? `{"t":${t},${line.slice(1)}` : line) + "\n");
    try {
      const event = JSON.parse(line);
      if (event.type === "result") result = event;
    } catch {
      // non-JSON line, already kept in the log
    }
  }
  log.end();

  const exitCode = await new Promise<number | null>((done) => child.on("close", done));
  clearTimeout(timer);

  // The paper is the structured output; output.md is its markdown rendering, kept so a run stays
  // readable with cat. A result without a valid paper (the model answered in text) is a failed run.
  const paper = parsePaper(result?.structured_output);
  if (paper && process.env.TYPESAFE_API_KEY && config.rate !== false) {
    await ratePaper(paper, dir, process.env.TYPESAFE_API_KEY).catch((err) => writeFile(join(dir, "rate.log"), `failed: ${err}\n`));
  }
  const output = paper ? toMarkdown(paper, { contextLabel: config.contextLabel }) : (result?.result ?? "");
  await writeFile(join(dir, "output.md"), output);
  if (paper) await writeFile(join(dir, "output.json"), JSON.stringify(paper, null, 2));
  const ok = exitCode === 0 && !timedOut && !!result && !result.is_error && !!paper;
  const meta: RunMeta = {
    ...running,
    finishedAt: new Date().toISOString(),
    status: ok ? "ok" : "failed",
    exitCode,
    timedOut,
    costUsd: result?.total_cost_usd,
    turns: result?.num_turns,
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  // The run directory keeps everything; the database gets what the API serves.
  const images = await readFile(join(dir, "images.json"), "utf8").then(JSON.parse, () => ({}));
  saveRun(meta, output, images, paper);
  return { meta, dir };
}
