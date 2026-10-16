import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { closeStaleRuns } from "./db.ts";
import { SCHEDULER, startScheduler } from "./scheduler.ts";

// The production server: the site is the TanStack Start app in app/, built by `npm run build` into
// dist/ (dist/client for the browser, dist/server/server.js for the server). This process serves
// dist/client's files, answers the health check, and hands every other request to the app. It also
// starts the scheduler. The app imports src/ through `#src/...` (package.json "imports") and the build
// leaves those imports alone, so the app and this file share one runner, database and run set.
const PORT = Number(process.env.PORT ?? 4321);
// Loopback by default; the container sets HOST=0.0.0.0 and stays unpublished behind the reverse proxy.
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST = resolve(import.meta.dirname, "..", "dist");
const entry = join(DIST, "server", "server.js");
if (!existsSync(entry)) throw new Error("no dist/server/server.js: run `npm run build` first");
const site: { fetch: (request: Request) => Promise<Response> } = (await import(pathToFileURL(entry).href)).default;

const app = new Hono();

// Liveness endpoint for the container health check.
app.get("/healthz", (c) => c.text("ok"));

// Vite's assets are hashed, so they can be cached for good; the rest (icons, manifest, sw.js) briefly.
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.ok) c.header("cache-control", "public, max-age=31536000, immutable");
});
// serveStatic resolves relative to the cwd.
app.use(serveStatic({ root: relative(process.cwd(), join(DIST, "client")) || "." }));
app.use(async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
});

// Pages, the JSON API and the dashboard; the app sets its own CSP (app/start.ts).
app.all("*", (c) => site.fetch(c.req.raw));

const stale = closeStaleRuns();
if (stale) console.log(`closed ${stale} run(s) cut off by the last restart`);
if (SCHEDULER) startScheduler();
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => console.log(`pergent on http://${HOST}:${PORT}`));
