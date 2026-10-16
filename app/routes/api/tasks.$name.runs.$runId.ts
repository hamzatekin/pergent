import { createFileRoute } from "@tanstack/react-router";
import { readRun } from "#src/runner.ts";
import { markRead } from "#src/scheduler.ts";

// A run: meta, output, images and paper. Fetching one counts as a read, like opening it on the page.
export const Route = createFileRoute("/api/tasks/$name/runs/$runId")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const run = readRun(params.name, params.runId);
        if (!run) return Response.json({ error: "not found" }, { status: 404 });
        markRead();
        return Response.json(run);
      },
    },
  },
});
