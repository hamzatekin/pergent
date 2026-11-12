import { createFileRoute } from "@tanstack/react-router";
import { RADAR, overviewOf } from "#src/ideas.ts";
import { listTasks } from "#src/runner.ts";
import { startRun } from "#src/scheduler.ts";
import { guardPost, seeOther } from "../../server/admin.ts";

// Refresh on the Ideas page: starts the radar's overview run (tasks/ideas-overview, tasks/gym-overview),
// then back to the page it came from, which refreshes itself until the new overview is there.
export const Route = createFileRoute("/admin/ideas/overview")({
  server: {
    handlers: {
      // Only the form posts here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        const form = await request.formData();
        const radar = String(form.get("radar") || RADAR);
        const task = overviewOf(radar);
        // Only a radar's own overview task: the form's value never names any other task to start.
        if (!/^[a-z0-9-]+$/.test(radar) || !(await listTasks()).includes(task)) return new Response("no overview task", { status: 404 });
        startRun(task);
        await new Promise((done) => setTimeout(done, 300)); // let the run's row land before the redirect
        const category = String(form.get("category") ?? "");
        const query = new URLSearchParams(Object.entries({ radar: radar === RADAR ? "" : radar, category }).filter(([, v]) => /^[a-z0-9-]+$/.test(v))).toString();
        return seeOther(`/ideas${query ? `?${query}` : ""}`);
      },
    },
  },
});
