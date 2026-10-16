import { createFileRoute } from "@tanstack/react-router";
import { readRun } from "#src/runner.ts";
import { markRead } from "#src/scheduler.ts";
import { canRead } from "../../server/admin.ts";

// A run: meta, output, images and paper. Fetching one counts as a read, like opening it on the page.
export const Route = createFileRoute("/api/tasks/$name/runs/$runId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const run = (await canRead(params.name)) ? readRun(params.name, params.runId) : null;
        if (!run) return Response.json({ error: "not found" }, { status: 404 });
        markRead();
        return Response.json(run);
      },
    },
  },
});
