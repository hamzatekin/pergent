import { createFileRoute } from "@tanstack/react-router";
import { listTasks } from "#src/runner.ts";

// The JSON API, read-only, kept for curl and debugging: prompts and configs live in git and deploy by
// push; runs are started by the scheduler, the dashboard or the CLI.
export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      GET: async () => Response.json(await listTasks()),
    },
  },
});
