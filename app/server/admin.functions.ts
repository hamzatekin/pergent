import { notFound, redirect } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { listRuns, listTasks, loadTask, readRun, runDir, type RunMeta } from "#src/runner.ts";
import { listMutes } from "#src/db.ts";
import { suggestions } from "#src/mute.ts";
import { isRunning, isWaiting, schedulerStatus } from "#src/scheduler.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDate } from "./format.ts";

// Whether the dashboard exists and this visitor is in; the admin layout's beforeLoad asks first.
export const getAdminSession = createServerFn({ method: "GET" }).handler(() => ({ enabled: !!PASSWORD, loggedIn: loggedIn() }));

// Every dashboard read checks the cookie itself too, since a server function can be called directly.
const adminOnly = createMiddleware({ type: "function" }).server(({ next }) => {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next: undefined, failed: undefined } });
  setResponseHeader("cache-control", "no-store");
  return next();
});

export type Status = "ok" | "failed" | "running" | "stopped";

// A "running" row with no run going in this server was cut off by a restart (or is a CLI run).
const statusOf = (r: RunMeta, busy: boolean): Status => (r.status === "running" && !busy ? "stopped" : r.status);

// A live run counts up to now; a run cut off before it finished has no end, so no time.
function duration(r: RunMeta, busy = false) {
  const end = r.finishedAt ? Date.parse(r.finishedAt) : busy ? Date.now() : NaN;
  const secs = Math.round((end - Date.parse(r.startedAt)) / 1000);
  if (!Number.isFinite(secs)) return "";
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const money = (usd: number) => `$${usd.toFixed(2)}`;

// /admin: a card per task (last run, average cost of the last 10, the last 30 days, Run now) and the
// latest 100 runs.
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async () => {
    const tasks = await listTasks();
    const runs = new Map(tasks.map((t) => [t, listRuns(t)] as const));
    const configs = new Map(await Promise.all(tasks.map(async (t) => [t, await loadTask(t).then((x) => x.config, () => undefined)] as const)));
    const since = Date.now() - 30 * 86_400_000;
    const status = schedulerStatus();

    const cards = tasks.map((task) => {
      const all = runs.get(task)!;
      const month = all.filter((r) => Date.parse(r.startedAt) >= since);
      const recent = all.filter((r) => r.costUsd !== undefined).slice(0, 10);
      const busy = isRunning(task);
      return {
        task,
        busy,
        waiting: isWaiting(task),
        last: all[0] && { status: statusOf(all[0], busy), ago: ago(all[0].startedAt) },
        avgCost: `${money(avg(recent.map((r) => r.costUsd!)))}`,
        avgOf: recent.length,
        month: `${money(sum(month.map((r) => r.costUsd ?? 0)))} · ${month.length} run${month.length === 1 ? "" : "s"}`,
        muted: configs.get(task)?.mute ? listMutes(task).length : undefined,
      };
    });

    const rows = tasks
      .flatMap((t) => runs.get(t)!)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100)
      .map((r) => {
        // The server runs one of a task at a time, so only the task's newest run can be the live one.
        const busy = r.status === "running" && isRunning(r.task) && runs.get(r.task)![0] === r;
        return {
          task: r.task,
          runId: r.runId,
          started: formatDate(r.startedAt, configs.get(r.task)?.timezone),
          status: statusOf(r, busy),
          turns: r.turns,
          time: duration(r, busy),
          cost: r.costUsd === undefined ? "" : money(r.costUsd),
        };
      });

    return { scheduler: status.scheduler, lastRead: status.lastReadAt && ago(status.lastReadAt), cards, rows, anyRunning: tasks.some(isRunning) };
  });

type Usage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number };
export type Step = { kind: "said" | "tool" | "result"; name?: string; t?: number; text: string; error?: boolean };

// The stream-json log as a list of steps: what the model said, each tool call with its input, and
// what came back, cut short; the full log is one click away under Files.
function parseLog(log: string) {
  const steps: Step[] = [];
  let result: { modelUsage?: Record<string, Usage> } | undefined;
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… (${s.length.toLocaleString("en")} chars)` : s);
  for (const line of log.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result") result = event;
    if (event.type !== "assistant" && event.type !== "user") continue;
    // `t` (seconds since claude started) is stamped by the runner; logs from before it have none.
    const t = typeof event.t === "number" ? Math.round(event.t) : undefined;
    for (const part of event.message?.content ?? []) {
      if (part.type === "text" && part.text.trim()) {
        steps.push({ kind: "said", t, text: clip(part.text, 1500) });
      } else if (part.type === "tool_use") {
        // The paper, and whether it arrived empty (cut off, or unparseable). The event's usage and
        // stop reason are from the start of the message, not its end, so they are not shown; the
        // cost-by-model table has the real output tokens.
        const paper = `(the paper${part.input && Object.keys(part.input).length === 0 ? ", empty input" : ""})`;
        const input = part.name === "StructuredOutput" ? paper : JSON.stringify(part.input);
        steps.push({ kind: "tool", name: part.name, t, text: clip(input, 400) });
      } else if (part.type === "tool_result") {
        const content = typeof part.content === "string" ? part.content : (part.content ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
        steps.push({ kind: "result", t, text: clip(content, 300), error: !!part.is_error });
      }
    }
  }
  return { steps, result };
}

const tokens = (n: number) => (n ?? 0).toLocaleString("en");

// /admin/runs/<task>/<runId>: cost by model, before.log, stderr.log, the steps, and every file.
export const getRunDetail = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((data: { task: string; runId: string }) => data)
  .handler(async ({ data: { task, runId } }) => {
    const all = listRuns(task);
    const meta = all.find((r) => r.runId === runId);
    if (!meta) throw notFound();
    const dir = runDir(task, runId);
    const files = (await readdir(dir).catch(() => [] as string[])).sort();
    const text = (file: string) => readFile(join(dir, file), "utf8").catch(() => "");
    const timezone = await loadTask(task).then((t) => t.config.timezone, () => undefined);
    const [before, stderr, log] = await Promise.all([text("before.log"), text("stderr.log"), text("log.jsonl")]);
    const { steps, result } = parseLog(log);
    const busy = meta.status === "running" && isRunning(task) && all[0]?.runId === runId;
    return {
      task,
      runId,
      started: formatDate(meta.startedAt, timezone),
      status: statusOf(meta, busy),
      ok: meta.status === "ok",
      timedOut: !!meta.timedOut,
      exitCode: meta.exitCode ?? null,
      cost: meta.costUsd === undefined ? "–" : money(meta.costUsd),
      turns: meta.turns ?? "–",
      time: duration(meta, busy) || "–",
      busy,
      files,
      models: Object.entries(result?.modelUsage ?? {}).map(([model, u]) => ({
        model,
        input: tokens(u.inputTokens),
        cacheWrite: tokens(u.cacheCreationInputTokens),
        cacheRead: tokens(u.cacheReadInputTokens),
        output: tokens(u.outputTokens),
        cost: money(u.costUSD),
      })),
      before,
      stderr: stderr.trim() ? stderr : "",
      steps,
    };
  });

// The never-show pages of a task with `"mute": true` (src/mute.ts): with a story, its suggestions
// (its source, "Pains like this one"); always the field for anything else and the list.
export const getMutePage = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .validator((data: { task: string; runId?: string; section?: string; story?: string }) => data)
  .handler(async ({ data }) => {
    const { task } = data;
    const config = (await listTasks()).includes(task) ? await loadTask(task).then((t) => t.config, () => null) : null;
    if (!config?.mute) throw notFound();
    let story: { headline: string; source?: string; picks: { phrase: string; label: string }[] } | undefined;
    if (data.runId) {
      const found = readRun(task, data.runId)?.paper.sections[Number(data.section)]?.stories[Number(data.story)];
      if (!found) throw notFound();
      story = { headline: found.headline, source: found.source, picks: suggestions(found) };
    }
    return { task, story, back: data.runId ? `/read/${task}/${data.runId}` : `/read/${task}`, muted: listMutes(task) };
  });
