import { createFileRoute } from "@tanstack/react-router";
import { listTasks } from "#src/runner.ts";
import { startRun } from "#src/scheduler.ts";
import { guardPost, seeOther } from "../../server/admin.ts";

// Brief me on the Ideas page: starts the brief run (tasks/ideas-brief), then back to the page, which
// refreshes itself until the brief is there.
export const Route = createFileRoute("/admin/ideas/brief")({
  server: {
    handlers: {
      // Only the form posts here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        if (!(await listTasks()).includes("ideas-brief")) return new Response("no brief task", { status: 404 });
        startRun("ideas-brief");
        await new Promise((done) => setTimeout(done, 300)); // let the run's row land before the redirect
        return seeOther("/ideas");
      },
    },
  },
});
