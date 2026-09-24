import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { listRuns, listTasks, loadTask, runDir, type RunMeta } from "./runner.ts";
import { escapeHtml } from "./paper.ts";

// The dashboard: cost, turns and logs of every run, and a button to start a task. Rendered on the
// server like the paper. It is behind one password, ADMIN_PASSWORD; without it /admin does not exist.
// The session cookie is an HMAC of the password, so changing the password logs everyone out.
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const COOKIE = "pergent_admin";
const token = () => createHmac("sha256", PASSWORD).update("pergent-admin").digest("hex");

type Options = {
  startRun: (name: string) => boolean;
  isRunning: (name: string) => boolean;
  stylesheet: () => string;
  status: () => { scheduler: string; lastReadAt: string | null };
};

export function adminRoutes(app: Hono, { startRun, isRunning, stylesheet, status }: Options) {
  const loggedIn = (c: Context) => {
    const got = Buffer.from(getCookie(c, COOKIE) ?? "");
    const want = Buffer.from(token());
    return got.length === want.length && timingSafeEqual(got, want);
  };
  const page = (c: Context, title: string, body: string, refresh = false) =>
    c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${refresh ? '<meta http-equiv="refresh" content="10">' : ""}
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${stylesheet()}">
<title>${escapeHtml(title)} · pergent admin</title>
</head>
<body>
<div class="page admin">
${body}
</div>
</body>
</html>
`);

  app.use("/admin/*", async (c, next) => {
    if (!PASSWORD) throw new HTTPException(404, { message: "set ADMIN_PASSWORD to turn on the dashboard" });
    c.header("cache-control", "no-store");
    // The cookie is SameSite=Strict already; a POST from another site is refused on top of that. With
    // referrer-policy no-referrer the browser sends `Origin: null` for our own forms, so that passes.
    const origin = URL.parse(c.req.header("origin") ?? "");
    if (c.req.method === "POST" && origin && origin.host !== c.req.header("host")) throw new HTTPException(403, { message: "bad origin" });
    if (c.req.path === "/admin/login" || loggedIn(c)) return next();
    return c.redirect("/admin/login");
  });

  app.get("/admin/login", (c) =>
    page(
      c,
      "Log in",
      `<form method="post" action="/admin/login" class="login">
<h1 class="admin-title">pergent admin</h1>
${c.req.query("failed") !== undefined ? '<p class="note failed">Wrong password.</p>' : ""}
<input type="password" name="password" autocomplete="current-password" placeholder="Password" autofocus required>
<button type="submit" class="btn">Log in</button>
</form>`,
    ),
  );
  app.post("/admin/login", async (c) => {
    const form = await c.req.parseBody();
    const given = createHmac("sha256", PASSWORD).update(String(form.password ?? "")).digest();
    const want = createHmac("sha256", PASSWORD).update(PASSWORD).digest();
    if (!timingSafeEqual(given, want)) {
      await new Promise((done) => setTimeout(done, 1000)); // slows down guessing
      return c.redirect("/admin/login?failed");
    }
    const secure = c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
    setCookie(c, COOKIE, token(), { path: "/admin", httpOnly: true, sameSite: "Strict", secure, maxAge: 30 * 86_400 });
    return c.redirect("/admin");
  });
  app.post("/admin/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/admin" });
    return c.redirect("/admin/login");
  });

  // Starts a task now, whatever the schedule and the pause say. A run started after today's slot also
  // counts for it: the scheduler only starts a task whose latest run began before the slot.
  app.post("/admin/run/:task", async (c) => {
    const task = c.req.param("task");
    if (!(await listTasks()).includes(task)) throw new HTTPException(404, { message: "no such task" });
    startRun(task);
    await new Promise((done) => setTimeout(done, 300)); // let the run's row land before the redirect
    return c.redirect("/admin");
  });

  app.get("/admin", async (c) => {
    const tasks = await listTasks();
    const runs = new Map(tasks.map((t) => [t, listRuns(t)] as const));
    const zones = new Map(await Promise.all(tasks.map(async (t) => [t, await loadTask(t).then((x) => x.config.timezone, () => undefined)] as const)));
    const since = Date.now() - 30 * 86_400_000;
    const s = status();

    const cards = tasks.map((task) => {
      const all = runs.get(task)!;
      const month = all.filter((r) => Date.parse(r.startedAt) >= since);
      const recent = all.filter((r) => r.costUsd !== undefined).slice(0, 10);
      const busy = isRunning(task);
      return `<div class="task-card">
<div class="task-card-head"><h2>${escapeHtml(task)}</h2>
<form method="post" action="/admin/run/${encodeURIComponent(task)}"><button type="submit" class="btn"${busy ? " disabled" : ""}>${busy ? "Running…" : "Run now"}</button></form></div>
<dl class="stats">
<div><dt>Last run</dt><dd>${all[0] ? `${statusBadge(all[0], busy)} ${ago(all[0].startedAt)}` : "never"}</dd></div>
<div><dt>Avg cost (last ${recent.length})</dt><dd>${money(avg(recent.map((r) => r.costUsd!)))}</dd></div>
<div><dt>Last 30 days</dt><dd>${money(sum(month.map((r) => r.costUsd ?? 0)))} · ${month.length} run${month.length === 1 ? "" : "s"}</dd></div>
</dl>
</div>`;
    });

    const latest = tasks
      .flatMap((t) => runs.get(t)!)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100);
    const rows = latest.map((r) => {
      // The server runs one of a task at a time, so only the task's newest run can be the live one.
      const busy = r.status === "running" && isRunning(r.task) && runs.get(r.task)![0] === r;
      return `<tr>
<td><a href="/admin/runs/${encodeURIComponent(r.task)}/${encodeURIComponent(r.runId)}">${formatDate(r.startedAt, zones.get(r.task))}</a></td>
<td>${escapeHtml(r.task)}</td>
<td>${statusBadge(r, busy)}</td>
<td class="num wide">${r.turns ?? ""}</td>
<td class="num wide">${duration(r, busy)}</td>
<td class="num">${r.costUsd === undefined ? "" : money(r.costUsd)}</td>
</tr>`;
    });

    const anyRunning = tasks.some(isRunning);
    return page(
      c,
      "Runs",
      `${topbar()}
<p class="note">Scheduler ${escapeHtml(s.scheduler)}${s.lastReadAt ? ` · paper last read ${ago(s.lastReadAt)}` : ""}${anyRunning ? " · this page refreshes while a run is going" : ""}</p>
<div class="task-cards">${cards.join("\n")}</div>
<div class="table-wrap"><table class="runs">
<thead><tr><th>Started</th><th>Task</th><th>Status</th><th class="num wide">Turns</th><th class="num wide">Time</th><th class="num">Cost</th></tr></thead>
<tbody>${rows.join("\n")}</tbody>
</table></div>
${latest.length ? "" : '<p class="note">No runs yet.</p>'}`,
      anyRunning,
    );
  });

  app.get("/admin/runs/:task/:runId", async (c) => {
    const { task, runId } = c.req.param();
    const meta = listRuns(task).find((r) => r.runId === runId);
    if (!meta) throw new HTTPException(404, { message: "no such run" });
    const dir = runDir(task, runId);
    const files = await readdir(dir).catch(() => [] as string[]);
    const text = (file: string) => readFile(join(dir, file), "utf8").catch(() => "");
    const timezone = await loadTask(task).then((t) => t.config.timezone, () => undefined);
    const [before, stderr, log] = await Promise.all([text("before.log"), text("stderr.log"), text("log.jsonl")]);
    const { steps, result } = parseLog(log);
    const busy = meta.status === "running" && isRunning(task) && listRuns(task)[0]?.runId === runId;
    const fileLink = (f: string) => `<a href="/admin/runs/${encodeURIComponent(task)}/${encodeURIComponent(runId)}/files/${encodeURIComponent(f)}">${escapeHtml(f)}</a>`;

    const models = Object.entries(result?.modelUsage ?? {}).map(
      ([model, u]) => `<tr><td>${escapeHtml(model)}</td><td class="num">${tokens(u.inputTokens)}</td><td class="num">${tokens(u.cacheCreationInputTokens)}</td><td class="num">${tokens(u.cacheReadInputTokens)}</td><td class="num">${tokens(u.outputTokens)}</td><td class="num">${money(u.costUSD)}</td></tr>`,
    );

    return page(
      c,
      `${task} ${runId}`,
      `${topbar()}
<h1 class="admin-title">${escapeHtml(task)} · ${formatDate(meta.startedAt, timezone)}</h1>
<dl class="stats">
<div><dt>Status</dt><dd>${statusBadge(meta, busy)}${meta.timedOut ? " (timed out)" : ""}${meta.exitCode ? ` (exit ${meta.exitCode})` : ""}</dd></div>
<div><dt>Cost</dt><dd>${meta.costUsd === undefined ? "–" : money(meta.costUsd)}</dd></div>
<div><dt>Turns</dt><dd>${meta.turns ?? "–"}</dd></div>
<div><dt>Time</dt><dd>${duration(meta, busy) || "–"}</dd></div>
</dl>
<p class="note">${meta.status === "ok" ? `<a href="/read/${encodeURIComponent(task)}/${encodeURIComponent(runId)}">Read the paper</a> · ` : ""}Files: ${files.sort().map(fileLink).join(", ") || "none"}</p>
${models.length ? `<h2 class="admin-head">Cost by model</h2>
<div class="table-wrap"><table class="runs"><thead><tr><th>Model</th><th class="num">Input</th><th class="num">Cache write</th><th class="num">Cache read</th><th class="num">Output</th><th class="num">Cost</th></tr></thead><tbody>${models.join("")}</tbody></table></div>` : ""}
${before ? `<h2 class="admin-head">before.log</h2><pre class="log">${escapeHtml(before)}</pre>` : ""}
${stderr.trim() ? `<h2 class="admin-head">stderr.log</h2><pre class="log">${escapeHtml(stderr)}</pre>` : ""}
<h2 class="admin-head">Steps (${steps.length})</h2>
${steps.length ? `<ol class="trace">${steps.join("\n")}</ol>` : '<p class="note">Nothing in log.jsonl yet.</p>'}`,
      busy,
    );
  });

  // Any file in the run directory as plain text: log.jsonl, the fetched inputs, output.json.
  app.get("/admin/runs/:task/:runId/files/:file", async (c) => {
    const { task, runId, file } = c.req.param();
    if (!listRuns(task).some((r) => r.runId === runId)) throw new HTTPException(404, { message: "no such run" });
    const dir = runDir(task, runId);
    if (!(await readdir(dir).catch(() => [] as string[])).includes(file)) throw new HTTPException(404, { message: "no such file" });
    c.header("content-type", "text/plain; charset=utf-8");
    return c.body(await readFile(join(dir, file)));
  });
}

const topbar = () => `<header class="topbar">
<nav class="tabs"><a href="/admin" class="tab" data-active="true">Runs</a><a href="/read" class="tab">Paper</a></nav>
<form method="post" action="/admin/logout"><button type="submit" class="linkbtn">Log out</button></form>
</header>`;

type Usage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number };

// The stream-json log as a list of steps: what the model said, each tool call with its input, and
// what came back, cut short; the full log is one click away under Files.
function parseLog(log: string) {
  const steps: string[] = [];
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
    const at = typeof event.t === "number" ? ` <span class="step-time">${Math.round(event.t)}s</span>` : "";
    for (const part of event.message?.content ?? []) {
      if (part.type === "text" && part.text.trim()) {
        steps.push(`<li class="step"><span class="step-kind">said${at}</span><div class="step-body">${escapeHtml(clip(part.text, 1500))}</div></li>`);
      } else if (part.type === "tool_use") {
        const input = part.name === "StructuredOutput" ? "(the paper)" : JSON.stringify(part.input);
        steps.push(`<li class="step"><span class="step-kind tool">${escapeHtml(part.name)}${at}</span><div class="step-body">${escapeHtml(clip(input, 400))}</div></li>`);
      } else if (part.type === "tool_result") {
        const content = typeof part.content === "string" ? part.content : (part.content ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
        steps.push(`<li class="step"><span class="step-kind${part.is_error ? " failed" : ""}">result${at}</span><div class="step-body muted">${escapeHtml(clip(content, 300))}</div></li>`);
      }
    }
  }
  return { steps, result };
}

function statusBadge(r: RunMeta, busy: boolean) {
  // A "running" row with no run going in this server was cut off by a restart.
  const status = r.status === "running" && !busy ? "stopped" : r.status;
  return `<span class="badge" data-status="${status}">${status}</span>`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const money = (usd: number) => `$${usd.toFixed(2)}`;
const tokens = (n: number) => (n ?? 0).toLocaleString("en");

// A live run counts up to now; a run cut off before it finished has no end, so no time.
function duration(r: RunMeta, busy = false) {
  const end = r.finishedAt ? Date.parse(r.finishedAt) : busy ? Date.now() : NaN;
  const secs = Math.round((end - Date.parse(r.startedAt)) / 1000);
  if (!Number.isFinite(secs)) return "";
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function formatDate(iso: string, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleString("en-GB", { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleString("en-GB", opts);
  }
}
