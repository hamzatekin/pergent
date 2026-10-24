import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { getRun, listMutes, openDb, saveIssues, saveJobs, savePosts, saveRun, listRuns as listRunRows } from "./db.ts";
import { PAPER_SCHEMA, fromMarkdown, parsePaper, toMarkdown, type Paper } from "./paper.ts";
import { ratePaper } from "./rate.ts";
import { addPreviewImages } from "./images.ts";
import { mutedMarkdown } from "./mute.ts";
import { notifyPaper, type NotifyRule } from "./notify.ts";
import { prepareRead, readSchema, saveReadOutput } from "./jobs.ts";
import { RADAR, briefSchema, judgeSchema, prepareBrief, prepareJudge, prepareSort, saveBriefOutput, saveJudgeOutput, saveSortOutput, sortSchema } from "./ideas.ts";

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
  /** The sidebar's icon for the task, by name from app/components/Icon.tsx (sun, newspaper, cpu, flame, landmark). */
  icon?: string;
  /** Where the task's tab sits: lower first, default 0, ties by name. The first task is the front page. */
  order?: number;
  /** Files the before scripts wrote into the run directory, joined into the prompt ahead of prompt.md, each in a `<file name>` tag. */
  inputs?: string[];
  /** Replaces Claude Code's built-in system prompt, which is written for a coding agent. */
  systemPrompt?: string;
  /** Who reads the tab and what they care about: with TYPESAFE_API_KEY set, Jev scores every story against it (src/rate.ts) and the page puts what is for them first. */
  reader?: string;
  /** false turns off Jev's per-story score even when the task has a `reader`. */
  rate?: boolean;
  /** Reasoning effort (low, medium, high, xhigh, max) passed as --effort; the thinking is billed as output. */
  effort?: string;
  /** Output token cap for one claude reply (CLAUDE_CODE_MAX_OUTPUT_TOKENS); the whole paper is one reply. */
  maxOutputTokens?: number;
  /** true gives the task a never-show list (src/mute.ts): a "Never show" link on every story, and muted.md in each run directory. */
  mute?: boolean;
  /** Pushes the paper's biggest stories to the reader's phone through ntfy (src/notify.ts, NTFY_TOPIC): those of `importance` or more in sections whose heading contains `section`. */
  notify?: NotifyRule;
  /** Lays the task's page out as a printed newspaper instead of cards (app/server/newspaper-view.ts): the masthead's name and motto. */
  newspaper?: { name?: string; motto?: string };
  /** false keeps the task out of the sidebar and the reading pages: it writes no paper (the ideas radar). */
  tab?: boolean;
  /** What the run hands back instead of a paper, by name from OUTPUTS below (the ideas radar's "sort", "judge" and "brief", the job tracker's "read"). */
  output?: string;
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

// A task without a prompt.md has an empty prompt, and its run is its before command alone.
export type Task = { name: string; config: TaskConfig; prompt: string };

export async function listTasks(): Promise<string[]> {
  const entries = await readdir(TASKS_DIR, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const order = new Map(
    await Promise.all(
      names.map(async (n) => [n, await readFile(join(TASKS_DIR, n, "task.json"), "utf8").then((t) => Number(JSON.parse(t).order ?? 0), () => 0)] as const),
    ),
  );
  return names.sort((a, b) => order.get(a)! - order.get(b)!);
}

export async function loadTask(name: string): Promise<Task> {
  const dir = join(TASKS_DIR, name);
  const config: TaskConfig = JSON.parse(await readFile(join(dir, "task.json"), "utf8"));
  const prompt = await readFile(join(dir, "prompt.md"), "utf8").catch(() => "");
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

// Runs that hand back something other than a paper. `prepare` writes the run's input files after
// `before` (false: nothing to do, and the run ends ok without claude), `schema` is what claude's
// structured output is held to, and `save` stores it, returning output.md, or null when the output is
// unusable and the run failed.
type Output = {
  prepare: (task: string, runId: string, dir: string, config: TaskConfig) => Promise<{ go: boolean; note: string }>;
  schema: (config: TaskConfig) => object;
  save: (runId: string, output: unknown, dir: string, config: TaskConfig) => Promise<string | null>;
};
const OUTPUTS: Record<string, Output> = {
  sort: {
    prepare: async (task, runId, dir, config) => {
      const { posts, waiting } = await prepareSort(task, runId, dir, config, listMutes(task));
      return { go: posts > 0, note: `${posts} posts to sort${waiting ? `, ${waiting} more waiting for the next runs` : ""}` };
    },
    schema: sortSchema,
    save: saveSortOutput,
  },
  judge: {
    prepare: async (_task, _runId, dir, config) => {
      const { problems } = await prepareJudge(dir, config, listMutes(RADAR));
      return { go: problems > 0, note: problems ? `${problems} problems to judge` : "Nothing to judge" };
    },
    schema: judgeSchema,
    save: (runId, output, dir) => saveJudgeOutput(runId, output, dir),
  },
  brief: {
    prepare: async (_task, _runId, dir) => {
      const { problems } = await prepareBrief(dir, listMutes(RADAR));
      return { go: problems > 0, note: problems ? `${problems} problems on the radar` : "Nothing on the radar yet" };
    },
    schema: briefSchema,
    save: (runId, output, dir) => saveBriefOutput(runId, output, dir),
  },
  read: {
    prepare: async (task, _runId, dir, config) => {
      const { adverts, waiting } = await prepareRead(dir, join(TASKS_DIR, task), config);
      return { go: adverts > 0, note: adverts ? `${adverts} adverts to read${waiting ? `, ${waiting} more waiting for the next runs` : ""}` : "No advert to read" };
    },
    schema: readSchema,
    save: (runId, output, dir) => saveReadOutput(runId, output, dir),
  },
};

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

// One before command at a time in this process. Tasks fetch from the same places (FxTwitter, which
// answered 404 when news and tech fetched in the same minute; Reddit, one RSS request a minute), so
// their fetches take turns. The wait does not count toward the 5 minutes.
let fetching: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const turn = fetching.then(fn);
  fetching = turn.catch(() => {});
  return turn;
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

const SYSTEM_PROMPT =
  "You write a daily newspaper for one reader from the source material you are given. The user message holds the source files and the editor's brief. You deliver the paper by calling the StructuredOutput tool once, with the paper object as the tool's arguments: `title` a string and `sections` an array of objects, never a JSON string. Do not write the paper, or any JSON, as a text reply: a paper written as text is thrown away and has to be written again as a tool call.";

// The input files go into the prompt itself, ahead of the brief, so the model starts writing on its
// first turn instead of spending one on Read calls (whose results then ride along on every later
// turn) and so no file is cut off at Read's ~25k-token limit. Each file sits in a <file> tag rather
// than under a heading, since the files have # and ## headings of their own. A missing file is said
// to be missing.
async function withInputs(dir: string, inputs: string[], prompt: string): Promise<string> {
  if (!inputs.length) return prompt;
  const files = await Promise.all(
    inputs.map(async (f) => `<file name="${f}">\n${(await readFile(join(dir, f), "utf8").catch(() => "(missing: the fetch for this file failed)")).trim()}\n</file>`),
  );
  return `${files.join("\n\n")}\n\n${prompt}`;
}

export async function runTask(name: string): Promise<{ meta: RunMeta; dir: string }> {
  const { config, prompt } = await loadTask(name);
  const custom = config.output ? OUTPUTS[config.output] : undefined;
  if (config.output && !custom) throw new Error(`${name}: unknown output ${config.output}`);
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const dir = runDir(name, runId);
  await mkdir(dir, { recursive: true });
  if (prompt) await writeFile(join(dir, "prompt.md"), prompt);
  const running: RunMeta = { task: name, runId, startedAt: startedAt.toISOString(), status: "running" };
  await writeFile(join(dir, "meta.json"), JSON.stringify(running, null, 2));
  saveRun(running);
  // A run that ends before claude: a failed before, or nothing for claude to do.
  const end = async (ok: boolean, output: string) => {
    const meta: RunMeta = { ...running, finishedAt: new Date().toISOString(), status: ok ? "ok" : "failed" };
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    await writeFile(join(dir, "output.md"), output);
    saveRun(meta, output);
    return { meta, dir };
  };
  // The never-show list, for the before scripts and the prompt (when the task lists it in inputs).
  if (config.mute) await writeFile(join(dir, "muted.md"), mutedMarkdown(listMutes(name)));

  if (config.before) {
    let ok = await oneAtATime(() => runBefore(config.before!, dir, join(TASKS_DIR, name)));
    // Newsletter issues as published (scripts/fetch-newsletters.ts) go to the Newsletters page whatever
    // becomes of the paper.
    await readFile(join(dir, "issues.json"), "utf8").then((t) => saveIssues(name, runId, JSON.parse(t))).catch(() => {});
    // Posts for the ideas radar (scripts/collect-posts.ts), likewise; a run whose posts could not be
    // saved failed, since they are what it is for.
    await readFile(join(dir, "posts.json"), "utf8").then((t) => savePosts(name, runId, JSON.parse(t))).catch(async (err) => {
      if (err?.code === "ENOENT") return;
      ok = false;
      await writeFile(join(dir, "save.log"), `posts.json not saved: ${err}\n`);
    });
    // Job adverts for the job market tracker (scripts/collect-jobs.ts), the same way.
    await readFile(join(dir, "jobs.json"), "utf8").then((t) => saveJobs(name, runId, JSON.parse(t))).catch(async (err) => {
      if (err?.code === "ENOENT") return;
      ok = false;
      await writeFile(join(dir, "save.log"), `jobs.json not saved: ${err}\n`);
    });
    if (!ok || !prompt) return end(ok, "");
  }
  if (custom) {
    // A prepare that throws fails the run, rather than leaving its row `running` until the next restart.
    const prepared = await custom.prepare(name, runId, dir, config).catch(async (err) => {
      await writeFile(join(dir, "prepare.log"), `failed: ${err?.stack ?? err}\n`);
      return null;
    });
    if (!prepared) return end(false, "");
    const { go, note } = prepared;
    await writeFile(join(dir, "prepare.log"), note + "\n");
    if (!go) return end(true, `${note}.\n`);
  }

  // strict-mcp-config: ignore the user-level MCP servers; a task gets only what its own config names.
  // json-schema: the paper comes back as structured output, held to the schema on the model's side.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--json-schema", JSON.stringify(custom ? custom.schema(config) : PAPER_SCHEMA)];
  if (config.model) args.push("--model", config.model);
  if (config.effort) args.push("--effort", config.effort);
  // --tools is what the model gets to see; --allowedTools only pre-approves, and on its own leaves the
  // rest of the built-in set (Bash, Edit, ...) available wherever settings let them through.
  // An empty list is `--tools ""`: no built-in tools at all, only the StructuredOutput that
  // --json-schema adds.
  const tools = (config.allowedTools ?? []).join(",");
  args.push("--tools", tools);
  if (tools) args.push("--allowedTools", tools);
  // Claude Code's own system prompt is written for editing software and rides along on every turn.
  args.push("--system-prompt", config.systemPrompt ?? SYSTEM_PROMPT);

  // No API key in the child env, so claude falls back to the subscription login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  // The paper is one StructuredOutput call, and a reply past claude's output cap (32k tokens by
  // default) is cut off mid-JSON and arrives as an empty object; a long Turkish paper got there.
  if (config.maxOutputTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(config.maxOutputTokens);

  const child = track(spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], detached: true }));
  child.stdin.end(await withInputs(dir, config.inputs ?? [], prompt));
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

  const finished = { exitCode, timedOut, costUsd: result?.total_cost_usd, turns: result?.num_turns };
  if (custom) {
    // Not a paper: the output is stored where it belongs (Output.save), output.json keeps it as it came
    // and output.md is what save said about it.
    if (result?.structured_output) await writeFile(join(dir, "output.json"), JSON.stringify(result.structured_output, null, 2));
    const answered = exitCode === 0 && !timedOut && !!result && !result.is_error;
    const saved = answered
      ? await custom.save(runId, result!.structured_output, dir, config).catch(async (err) => {
          await writeFile(join(dir, "save.log"), `${err instanceof Error ? err.stack : err}\n`);
          return null;
        })
      : null;
    const output = saved ?? result?.result ?? "";
    await writeFile(join(dir, "output.md"), output);
    const meta: RunMeta = { ...running, finishedAt: new Date().toISOString(), status: saved !== null ? "ok" : "failed", ...finished };
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    saveRun(meta, output);
    return { meta, dir };
  }

  // The paper is the structured output; output.md is its markdown rendering, kept so a run stays
  // readable with cat. A result without a valid paper (the model answered in text) is a failed run.
  const paper = parsePaper(result?.structured_output);
  if (paper && process.env.TYPESAFE_API_KEY && config.reader && config.rate !== false) {
    await ratePaper(paper, dir, process.env.TYPESAFE_API_KEY, config.reader).catch((err) => writeFile(join(dir, "rate.log"), `failed: ${err}\n`));
  }
  const output = paper ? toMarkdown(paper, { contextLabel: config.contextLabel }) : (result?.result ?? "");
  await writeFile(join(dir, "output.md"), output);
  if (paper) await writeFile(join(dir, "output.json"), JSON.stringify(paper, null, 2));
  const ok = exitCode === 0 && !timedOut && !!result && !result.is_error && !!paper;
  const meta: RunMeta = {
    ...running,
    finishedAt: new Date().toISOString(),
    status: ok ? "ok" : "failed",
    ...finished,
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  // The run directory keeps everything; the database gets what the API serves.
  // Lead images for article sources (og:image), merged into images.json before it is read below.
  if (paper) await addPreviewImages(paper, dir).catch((err) => writeFile(join(dir, "images.log"), `failed: ${err}\n`));
  const images = await readFile(join(dir, "images.json"), "utf8").then(JSON.parse, () => ({}));
  saveRun(meta, output, images, paper);
  if (ok && config.notify) await notifyPaper(name, runId, paper, config.notify, dir).catch((err) => writeFile(join(dir, "notify.log"), `failed: ${err}\n`));
  return { meta, dir };
}
