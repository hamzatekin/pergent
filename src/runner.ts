import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { getRun, openDb, saveRun, listRuns as listRunRows } from "./db.ts";

const ROOT = resolve(import.meta.dirname, "..");
const TASKS_DIR = join(ROOT, "tasks");
const RUNS_DIR = join(ROOT, "runs");
await mkdir(RUNS_DIR, { recursive: true });
openDb(RUNS_DIR);

export type TaskConfig = {
  schedule?: string;
  model?: string;
  allowedTools?: string[];
  timeoutMinutes?: number;
  /** Shell command run in the run directory before claude starts. Gets TASK_DIR in its env. */
  before?: string;
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

export function listRuns(name: string): RunMeta[] {
  return listRunRows(name);
}

// What the reading view needs: the output, and the lead images the before scripts found
// (images.json, article link -> image URL). The log and stderr stay on disk.
export function readRun(name: string, runId: string) {
  return getRun(name, runId);
}

function runBefore(command: string, cwd: string, taskDir: string): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn("sh", ["-c", command], { cwd, env: { ...process.env, TASK_DIR: taskDir }, stdio: ["ignore", "pipe", "pipe"] });
    const log = createWriteStream(join(cwd, "before.log"));
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("close", (code) => done(code === 0));
  });
}

export async function runTask(name: string): Promise<{ meta: RunMeta; dir: string }> {
  const { config, prompt } = await loadTask(name);
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const dir = join(RUNS_DIR, name, runId);
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
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config"];
  if (config.model) args.push("--model", config.model);
  if (config.allowedTools?.length) args.push("--allowedTools", config.allowedTools.join(","));

  // No API key in the child env, so claude falls back to the subscription login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const child = spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(prompt);
  child.stderr.pipe(createWriteStream(join(dir, "stderr.log")));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, (config.timeoutMinutes ?? 15) * 60_000);

  const log = createWriteStream(join(dir, "log.jsonl"));
  let result: { result?: string; is_error?: boolean; total_cost_usd?: number; num_turns?: number } | undefined;
  for await (const line of createInterface({ input: child.stdout })) {
    log.write(line + "\n");
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

  await writeFile(join(dir, "output.md"), result?.result ?? "");
  const ok = exitCode === 0 && !timedOut && !!result && !result.is_error;
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
  saveRun(meta, result?.result ?? "", images);
  return { meta, dir };
}
