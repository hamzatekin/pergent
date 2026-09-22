import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { listRuns, listTasks, loadTask, readRun, runTask, type RunMeta, type TaskConfig } from "./runner.ts";
import { escapeHtml, renderPaper } from "./paper.ts";
import { PAUSE_AFTER_DAYS, lastReadAt, markRead, paused, startScheduler } from "./scheduler.ts";

const PORT = Number(process.env.PORT ?? 4321);
// Loopback by default; the container sets HOST=0.0.0.0 and stays unpublished behind the reverse proxy.
const HOST = process.env.HOST ?? "127.0.0.1";
// serveStatic resolves relative to the cwd, so express dist/ that way.
const DIST = relative(process.cwd(), resolve(import.meta.dirname, "..", "dist")) || ".";

const running = new Set<string>();
// Only the container sets SCHEDULER=1; a local `npm run serve` never starts runs by itself.
const SCHEDULER = process.env.SCHEDULER === "1";
// Not strict: `/read/haberler/` is the same page as `/read/haberler`.
const app = new Hono({ strict: false });

function startRun(name: string): boolean {
  if (running.has(name)) return false;
  running.add(name);
  runTask(name).catch((err) => console.error(`run ${name} failed:`, err)).finally(() => running.delete(name));
  return true;
}

// The page carries the model's markdown as HTML unsanitized; the CSP keeps a script tag in a model
// output (a prompt injection through a headline, say) from running. Images come from anywhere.
app.use(async (c, next) => {
  await next();
  c.header("content-security-policy", "default-src 'self'; img-src https: data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
});

// Liveness endpoint for the container health check.
app.get("/healthz", (c) => c.text("ok"));

// Read-only, kept for curl and debugging: prompts and configs live in git and deploy by push; runs are
// started by the scheduler or the CLI. The page itself is rendered by the server, below.
app.get("/api/tasks", async (c) => c.json(await listTasks()));
app.get("/api/tasks/:name/runs", (c) => c.json(listRuns(c.req.param("name"))));
app.get("/api/tasks/:name/runs/:runId", (c) => {
  const run = readRun(c.req.param("name"), c.req.param("runId"));
  if (!run) return c.json({ error: "not found" }, 404);
  markRead();
  return c.json(run);
});
// What app.js calls once a page with a run is open: the read that keeps the scheduler alive. It is a
// script call on purpose, so a crawler fetching the page cannot keep a forgotten deployment running.
app.post("/api/read", (c) => {
  markRead();
  return c.body(null, 204);
});
app.get("/api/status", (c) => c.json(status()));
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

function status() {
  return { scheduler: !SCHEDULER ? "off" : paused() ? "paused" : "on", lastReadAt: lastReadAt(), pauseAfterDays: PAUSE_AFTER_DAYS };
}

// The reading view: `/` and `/read` show the first task's latest ok run, `/read/<task>[/<runId>]` a
// task or a run. Rendered whole on the server, chrome included, so a reader, a crawler and an LLM
// fetcher all get the same page; app.js only adds the arrow keys and the read ping.
app.get("/", page);
app.get("/read", page);
app.get("/read/:task", page);
app.get("/read/:task/:runId", page);

async function page(c: Context) {
  const tasks = await listTasks();
  const task = c.req.param("task") ?? tasks[0];
  if (!task || !tasks.includes(task)) throw new HTTPException(404, { message: "no such task" });
  const config = await loadTask(task).then((t) => t.config, () => ({}) as TaskConfig);
  const finished = listRuns(task).filter((r) => r.status !== "running");
  const runId = c.req.param("runId");
  const current = runId ? finished.find((r) => r.runId === runId) : (finished.find((r) => r.status === "ok") ?? finished[0]);
  if (runId && !current) throw new HTTPException(404, { message: "no such run" });
  const index = current ? finished.indexOf(current) : -1;
  const newer = index > 0 ? finished[index - 1] : undefined;
  const older = index >= 0 ? finished[index + 1] : undefined;
  const run = current ? readRun(task, current.runId) : null;
  const labels = new Map(await Promise.all(tasks.map(async (t) => [t, await loadTask(t).then((x) => x.config.label, () => undefined)] as const)));

  const notes: string[] = [];
  const s = status();
  if (s.scheduler === "paused") {
    notes.push(`Scheduled runs were paused: ${s.lastReadAt ? `the paper was last read ${daysAgo(s.lastReadAt)} days ago` : "the paper had not been opened yet"}. Reading it turns them back on.`);
  }
  if (!current) notes.push("No finished runs yet.");
  if (current?.status === "failed") notes.push('<span class="failed">This run failed.</span>');
  if (run && current?.status === "ok" && !run.paper.sections.length) notes.push("This run produced no output.");

  const title = run?.paper.title;
  const arrow = (r: RunMeta | undefined, label: string, glyph: string, key: string) =>
    `<a href="${r ? `/read/${task}/${r.runId}` : "#"}" class="arrow" aria-disabled="${!r}" aria-label="${label}" title="${label} (${key})" data-key="${key}">${glyph}</a>`;
  const html = `<!doctype html>
<html lang="${escapeHtml(config.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f3eee4">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="pergent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css?v=${version("styles.css")}">
<title>${title ? `${escapeHtml(title)} · ` : ""}pergent</title>
</head>
<body${run ? ` data-run="${escapeHtml(current!.runId)}"` : ""}>
<div class="page">
<header class="topbar">
<nav class="tabs">${tasks.map((t) => `<a href="/read/${t}" class="tab" data-active="${t === task}">${escapeHtml(labels.get(t) ?? t)}</a>`).join("")}</nav>
<div class="runnav">
${arrow(older, "Older run", "←", "ArrowLeft")}
<span class="stamp">${current ? formatDate(current.startedAt, config.timezone) : ""}</span>
${arrow(newer, "Newer run", "→", "ArrowRight")}
</div>
</header>
${notes.map((n) => `<p class="note">${n}</p>`).join("\n")}
${run ? renderPaper(run.paper, run.images, { contextLabel: config.contextLabel, briefsLabel: config.briefsLabel }) : ""}
</div>
<script src="/app.js?v=${version("app.js")}"></script>
</body>
</html>
`;
  return c.html(html);
}

// Cache buster for the two unhashed assets: the service worker caches them by URL, so a new build
// must be a new URL. The mtime is enough, and reading it per request keeps a dev rebuild visible.
function version(file: string) {
  try {
    return Math.floor(statSync(join(DIST, file)).mtimeMs).toString(36);
  } catch {
    return "0";
  }
}

const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

function formatDate(iso: string, timeZone?: string) {
  try {
    return new Date(iso).toLocaleString("en-GB", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
  } catch {
    return new Date(iso).toLocaleString("en-GB", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
}

// Everything else is a file under dist/: styles, app.js, the manifest, icons and the service worker.
app.use(serveStatic({ root: DIST }));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse(); // keep Hono's own status instead of a 500
  console.error(err);
  return c.json({ error: String(err) }, 500);
});

if (SCHEDULER) startScheduler(startRun);
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => console.log(`pergent on http://${HOST}:${PORT}`));
