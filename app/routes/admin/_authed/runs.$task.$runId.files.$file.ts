import { createFileRoute } from "@tanstack/react-router";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { listRuns, runDir } from "#src/runner.ts";
import { PASSWORD, loggedIn, seeOther } from "../../../server/admin.ts";

// Any file in the run directory as plain text: log.jsonl, the fetched inputs, output.json. Only names
// that readdir returns, so nothing outside the run directory.
export const Route = createFileRoute("/admin/_authed/runs/$task/$runId/files/$file")({
  server: {
    handlers: {
      GET: async ({ params: { task, runId, file } }) => {
        if (!PASSWORD) return new Response("not found", { status: 404 });
        if (!loggedIn()) return seeOther("/admin/login");
        if (!listRuns(task).some((r) => r.runId === runId)) return new Response("no such run", { status: 404 });
        const dir = runDir(task, runId);
        if (!(await readdir(dir).catch(() => [] as string[])).includes(file)) return new Response("no such file", { status: 404 });
        return new Response(await readFile(join(dir, file)), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      },
    },
  },
});
