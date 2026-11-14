import { createFileRoute } from "@tanstack/react-router";
import { duplicates } from "#src/compare.ts";
import { hideHomes, listHomes } from "#src/db.ts";
import { guardPost, seeOther } from "../../server/admin.ts";

// The task whose listings the Homes page shows (tasks/homes).
const TASK = "homes";

// The Homes page's Hide and Unhide buttons (Not interested): `id` is the listing, `action` hide or show.
// Either marks the listing and every sure copy of it up now (src/compare.ts duplicates): hiding all of
// them keeps a copy hidden after the link between them breaks (a rent cut past 5%, a re-read, the other
// copy taken down), and showing all of them clears whichever copy the reader hid. A copy that turns up
// later is hidden through src/homes.ts hiddenOf. The page's script posts here and asks for JSON, so the
// list keeps its place; without the script the form posts and comes back to `back`, the page it was on.
export const Route = createFileRoute("/admin/homes")({
  server: {
    handlers: {
      // Only the forms post here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const refused = guardPost(request);
        if (refused) return refused;
        const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
        const form = await request.formData();
        const id = String(form.get("id") ?? "");
        const action = String(form.get("action") ?? "");
        if (action !== "hide" && action !== "show") return new Response("unknown action", { status: 400 });
        const copies = (duplicates(listHomes(TASK).filter((h) => h.up)).get(id) ?? []).filter((c) => c.sure).map((c) => c.home.id);
        if (!hideHomes(TASK, [id, ...copies], action === "hide")) return wantsJson ? Response.json({ ok: false }, { status: 404 }) : new Response("no such listing", { status: 404 });
        if (wantsJson) return Response.json({ ok: true });
        const back = String(form.get("back") ?? "");
        return seeOther(/^\/homes(\?|$)/.test(back) ? back : "/homes");
      },
    },
  },
});
