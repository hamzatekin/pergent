import { createFileRoute } from "@tanstack/react-router";
import { removeMute } from "#src/db.ts";
import { guardPost, hasMuteList, seeOther } from "../../server/admin.ts";

export const Route = createFileRoute("/admin/mutes/remove")({
  server: {
    handlers: {
      // Only the form posts here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        const form = await request.formData();
        const task = String(form.get("task") ?? "");
        if (!(await hasMuteList(task))) return new Response("this task has no never-show list", { status: 404 });
        removeMute(task, String(form.get("phrase") ?? ""));
        return seeOther(`/admin/mutes/${encodeURIComponent(task)}`);
      },
    },
  },
});
