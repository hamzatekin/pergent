import { createFileRoute } from "@tanstack/react-router";
import { isLayout, layoutCookie } from "../layout.ts";

// The layout toggle on a paper's page posts here: it keeps the reader's choice for that task, the
// columns or the printed newspaper, in a cookie for a year and goes back to the page. The page's script
// sets the same cookie itself and skips the round trip; this is for a page that has not hydrated yet.
// A view preference, so no login and no origin check.
export const Route = createFileRoute("/layout")({
  server: {
    handlers: {
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const form = await request.formData();
        const layout = form.get("layout");
        const task = String(form.get("task") ?? "");
        const next = String(form.get("next") ?? "");
        const headers = new Headers({ location: /^\/(read(\/|$)|$)/.test(next) ? next : "/read", "cache-control": "no-store" });
        if (isLayout(layout) && /^[a-z0-9-]+$/.test(task)) headers.append("set-cookie", layoutCookie(task, layout));
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
