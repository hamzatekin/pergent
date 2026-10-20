import { createFileRoute } from "@tanstack/react-router";
import { askJudge, getProblem, mergeProblem, setProblemStatus } from "#src/db.ts";
import { listTasks } from "#src/runner.ts";
import { startRun } from "#src/scheduler.ts";
import { guardPost, seeOther } from "../../server/admin.ts";

// The Ideas problem page's buttons: Star and Unstar, Kill and Reopen, Judge again (asks the judge run,
// tasks/ideas-judge, to take this problem first, and starts it), and Merge into another problem. Each
// goes back to the problem's page (a merge to the problem it went into).
export const Route = createFileRoute("/admin/ideas/$id")({
  server: {
    handlers: {
      // Only the forms post here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request, params }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        const problem = /^\d+$/.test(params.id) ? getProblem(Number(params.id)) : null;
        if (!problem || problem.status === "merged") return new Response("no such problem", { status: 404 });
        const form = await request.formData();
        const action = String(form.get("action") ?? "");
        if (action === "star") setProblemStatus(problem.id, "starred");
        else if (action === "kill") setProblemStatus(problem.id, "killed");
        else if (action === "reopen") setProblemStatus(problem.id, "open");
        else if (action === "judge") {
          askJudge(problem.id);
          if ((await listTasks()).includes("ideas-judge")) startRun("ideas-judge");
          await new Promise((done) => setTimeout(done, 300)); // let the run's row land before the redirect
        } else if (action === "merge") {
          const into = getProblem(Number(form.get("into")));
          if (!into || into.id === problem.id || into.status === "merged") return new Response("no such problem to merge into", { status: 400 });
          mergeProblem(problem.id, into.id);
          return seeOther(`/ideas/${into.id}`);
        } else return new Response("unknown action", { status: 400 });
        return seeOther(`/ideas/${problem.id}`);
      },
    },
  },
});
