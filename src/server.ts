import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { listRuns, listTasks, loadTask, readRun, runTask, saveTask } from "./runner.ts";

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

async function api(method: string, path: string, body: string): Promise<{ status: number; data: unknown }> {
  const parts = path.split("/").filter(Boolean).slice(1); // drop "api"
  const [resource, name, sub, runId] = parts;

  if (resource === "tasks" && !name && method === "GET") {
    const tasks = await Promise.all((await listTasks()).map(loadTask));
    return { status: 200, data: tasks };
  }
  if (resource === "tasks" && name && !sub && method === "PUT") {
    await saveTask(name, JSON.parse(body));
    return { status: 200, data: await loadTask(name) };
  }
  if (resource === "tasks" && name && sub === "runs" && !runId && method === "GET") {
    return { status: 200, data: await listRuns(name) };
  }
  if (resource === "tasks" && name && sub === "runs" && runId && method === "GET") {
    return { status: 200, data: await readRun(name, runId) };
  }
  if (resource === "tasks" && name && sub === "run" && method === "POST") {
    if (running.has(name)) return { status: 409, data: { error: "already running" } };
    running.add(name);
    runTask(name).catch((err) => console.error(`run ${name} failed:`, err)).finally(() => running.delete(name));
    return { status: 202, data: { started: true } };
  }
  return { status: 404, data: { error: "not found" } };
}

function serveStatic(path: string, res: ServerResponse) {
  const file = join(DIST, path === "/" ? "index.html" : path);
  const target = existsSync(file) ? file : join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((done) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => done(data));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
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
    const { status, data } = await api(req.method ?? "GET", url.pathname, await readBody(req));
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
}).listen(PORT, HOST, () => console.log(`pergent on http://${HOST}:${PORT}`));
