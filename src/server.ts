import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { listRuns, listTasks, readRun, runTask } from "./runner.ts";

const PORT = Number(process.env.PORT ?? 4321);
// Loopback by default; the container sets HOST=0.0.0.0 and stays unpublished behind the reverse proxy.
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST = resolve(import.meta.dirname, "..", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const running = new Set<string>();

// One basic-auth login in front of everything when BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set.
// Deployed behind a proxy that does HTTPS this is the app's only protection; unset both for local use.
const AUTH = process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD
  ? Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASSWORD}`)
  : null;

function authorized(req: IncomingMessage): boolean {
  if (!AUTH) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6), "base64");
  return given.length === AUTH.length && timingSafeEqual(given, AUTH);
}

// Read-only apart from the run trigger: prompts and configs live in git and deploy by push.
async function api(method: string, path: string): Promise<{ status: number; data: unknown }> {
  const parts = path.split("/").filter(Boolean).slice(1); // drop "api"
  const [resource, name, sub, runId] = parts;

  if (resource === "tasks" && !name && method === "GET") {
    return { status: 200, data: await listTasks() };
  }
  if (resource === "tasks" && name && sub === "runs" && !runId && method === "GET") {
    return { status: 200, data: await listRuns(name) };
  }
  if (resource === "tasks" && name && sub === "runs" && runId && method === "GET") {
    const run = await readRun(name, runId);
    return run ? { status: 200, data: run } : { status: 404, data: { error: "not found" } };
  }
  // Kept for curl until there is a scheduler; the UI has no run button.
  if (resource === "tasks" && name && sub === "run" && method === "POST") {
    if (running.has(name)) return { status: 409, data: { error: "already running" } };
    running.add(name);
    runTask(name).catch((err) => console.error(`run ${name} failed:`, err)).finally(() => running.delete(name));
    return { status: 202, data: { started: true } };
  }
  return { status: 404, data: { error: "not found" } };
}

// Files under dist/, index.html for anything else (SPA routes, directories, missing files).
// URL parsing already resolves ".." segments; the prefix check is belt and braces.
function serveStatic(path: string, res: ServerResponse) {
  const file = resolve(DIST, "." + path);
  const isFile = file.startsWith(DIST + "/") && statSync(file, { throwIfNoEntry: false })?.isFile();
  const target = isFile ? file : join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
  createReadStream(target)
    .on("error", () => res.destroy())
    .pipe(res);
}

// The reading view injects the model's markdown as HTML unsanitized; the CSP keeps a script tag in a
// model output (a prompt injection through a headline, say) from running. Images come from anywhere.
const HEADERS = {
  "content-security-policy": "default-src 'self'; img-src https: data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);
  // Open liveness endpoint for the container health check; everything else is behind auth.
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="pergent"', "content-type": "text/plain" });
    return res.end("unauthorized");
  }
  if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);
  try {
    const { status, data } = await api(req.method ?? "GET", url.pathname);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
}).listen(PORT, HOST, () => console.log(`pergent on http://${HOST}:${PORT}`));
