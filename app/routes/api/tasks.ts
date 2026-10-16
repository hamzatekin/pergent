import { createFileRoute } from "@tanstack/react-router";
import { listTasks } from "#src/runner.ts";
import { canRead } from "../../server/admin.ts";

// The JSON API, read-only, kept for curl and debugging: prompts and configs live in git and deploy by
// push; runs are started by the scheduler, the dashboard or the CLI. A private task is listed only
// with the admin cookie.
export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      GET: async () => {
        const tasks = await listTasks();
        const shown = await Promise.all(tasks.map(canRead));
        return Response.json(tasks.filter((_, i) => shown[i]));
      },
    },
  },
});
