import { Hono, type Context, type Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { marked } from "marked";
import { listRuns, listTasks, readRun, runTask } from "./runner.ts";
import { PAUSE_AFTER_DAYS, lastReadAt, markRead, paused, startScheduler } from "./scheduler.ts";

const PORT = Number(process.env.PORT ?? 4321);
// Loopback by default; the container sets HOST=0.0.0.0 and stays unpublished behind the reverse proxy.
const HOST = process.env.HOST ?? "127.0.0.1";
// serveStatic resolves relative to the cwd, so express dist/ that way.
const DIST = relative(process.cwd(), resolve(import.meta.dirname, "..", "dist")) || ".";

const running = new Set<string>();
// Only the container sets SCHEDULER=1; a local `npm run serve` never starts runs by itself.
const SCHEDULER = process.env.SCHEDULER === "1";
// Not strict: `/read/haberler/` is the same page as `/read/haberler`, as the client already treats it.
const app = new Hono({ strict: false });

function startRun(name: string): boolean {
  if (running.has(name)) return false;
  running.add(name);
  runTask(name).catch((err) => console.error(`run ${name} failed:`, err)).finally(() => running.delete(name));
  return true;
}

// The reading view injects the model's markdown as HTML unsanitized; the CSP keeps a script tag in a
// model output (a prompt injection through a headline, say) from running. Images come from anywhere.
app.use(async (c, next) => {
  await next();
  c.header("content-security-policy", "default-src 'self'; img-src https: data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
});

// Liveness endpoint for the container health check.
app.get("/healthz", (c) => c.text("ok"));

// Read-only: prompts and configs live in git and deploy by push; runs are started by the scheduler or the CLI.
app.get("/api/tasks", async (c) => c.json(await listTasks()));
app.get("/api/tasks/:name/runs", (c) => c.json(listRuns(c.req.param("name"))));
// Fetching a run is what counts as reading the paper, which keeps the scheduler alive.
app.get("/api/tasks/:name/runs/:runId", (c) => {
  const run = readRun(c.req.param("name"), c.req.param("runId"));
  if (!run) return c.json({ error: "not found" }, 404);
  markRead();
  return c.json(run);
});
app.get("/api/status", (c) => c.json({
  scheduler: !SCHEDULER ? "off" : paused() ? "paused" : "on",
  lastReadAt: lastReadAt(),
  pauseAfterDays: PAUSE_AFTER_DAYS,
}));
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// LLM fetchers and crawlers run no JavaScript, so an empty app shell is all they would get. On the
// reading routes the run's markdown is rendered into index.html before it goes out; the app mounts
// over it on load. Same run choice as Read.tsx: the latest ok run unless a run id is given. Looking a
// run up here is not a read for the scheduler, or a crawler could keep a forgotten deployment alive.
async function prerender(c: Context, next: Next) {
  const task = c.req.param("task") ?? (await listTasks())[0];
  if (!task) return next();
  const finished = listRuns(task).filter((r) => r.status !== "running");
  const runId = c.req.param("runId");
  const current = runId ? finished.find((r) => r.runId === runId) : (finished.find((r) => r.status === "ok") ?? finished[0]);
  const run = current && readRun(task, current.runId);
  const shell = run?.output ? await readFile(join(DIST, "index.html"), "utf8").catch(() => null) : null;
  if (!run || !shell) return next();
  const title = run.output.match(/^# +(.+?) *$/m)?.[1];
  const body = marked.parse(run.output, { async: false });
  // Function replacers: `$&` or `$$` in the model's text must not be treated as replacement patterns.
  return c.html(
    shell
      .replace("<title>pergent</title>", () => `<title>${title ? `${escapeHtml(title)} · ` : ""}pergent</title>`)
      .replace('<div id="root"></div>', () => `<div id="root"><div class="page"><div class="paper prose">${body}</div></div></div>`),
  );
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
for (const path of ["/", "/read", "/read/:task", "/read/:task/:runId"]) app.get(path, prerender);

// Files under dist/, index.html for anything else (SPA routes, directories, missing files).
app.use(serveStatic({ root: DIST }));
app.use(serveStatic({ path: `${DIST}/index.html` }));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse(); // keep Hono's own status instead of a 500
  console.error(err);
  return c.json({ error: String(err) }, 500);
});

if (SCHEDULER) startScheduler(startRun);
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => console.log(`pergent on http://${HOST}:${PORT}`));
