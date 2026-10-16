import { createFileRoute } from "@tanstack/react-router";
import { listTasks } from "#src/runner.ts";
import { startRun } from "#src/scheduler.ts";
import { guardPost, seeOther } from "../../server/admin.ts";

// Run now: starts a task whatever the schedule and the pause say. A run started after today's slot
// also counts for it: the scheduler only starts a task whose latest run began before the slot.
export const Route = createFileRoute("/admin/run/$task")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        if (!(await listTasks()).includes(params.task)) return new Response("no such task", { status: 404 });
        startRun(params.task);
        await new Promise((done) => setTimeout(done, 300)); // let the run's row land before the redirect
        return seeOther("/admin");
      },
    },
  },
});
