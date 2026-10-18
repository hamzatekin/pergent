import { createFileRoute } from "@tanstack/react-router";
import { listTasks, loadTask, readRun } from "#src/runner.ts";
import { guardPost, seeOther } from "../../server/admin.ts";
import { canSaveNotes, saveToNotes } from "../../server/notes.ts";

// Saves a story to the reader's Aletheia Inbox (app/server/notes.ts). `place` names it by where it sits in
// the stored paper: task/runId/section/story. The page's script posts here and asks for JSON, so the paper
// stays where it was scrolled; without the script the form posts and comes back to the paper.
export const Route = createFileRoute("/admin/save")({
  server: {
    handlers: {
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
        const answer = (status: number, error: string) => (wantsJson ? Response.json({ ok: false, error }, { status }) : new Response(error, { status }));
        if (!canSaveNotes()) return answer(404, "set ALETHEIA_CAPTURE_KEY to save stories to your notes");
        const [task = "", runId = "", section, index] = String((await request.formData()).get("place") ?? "").split("/");
        if (!(await listTasks()).includes(task)) return answer(404, "no such task");
        const { config } = await loadTask(task);
        const story = config.private ? undefined : readRun(task, runId)?.paper.sections[Number(section)]?.stories[Number(index)];
        if (!story) return answer(404, "no such story");
        const saved = await saveToNotes(story, { label: config.label ?? task, contextLabel: config.contextLabel, timezone: config.timezone });
        if (!saved.ok) return answer(502, saved.error);
        return wantsJson ? Response.json(saved) : seeOther(`/read/${task}/${runId}`);
      },
    },
  },
});
