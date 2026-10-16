import { createFileRoute } from "@tanstack/react-router";
import { addMute } from "#src/db.ts";
import { backTo, guardPost, hasMuteList, seeOther } from "../../server/admin.ts";

// Adds a phrase to a task's never-show list (src/mute.ts), then back to the page it came from.
export const Route = createFileRoute("/admin/mutes")({
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
        const phrase = String(form.get("phrase") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
        // A single letter would match nearly every post.
        if (phrase.length >= 2) addMute(task, phrase);
        return seeOther(backTo(String(form.get("back") ?? ""), task));
      },
    },
  },
});
