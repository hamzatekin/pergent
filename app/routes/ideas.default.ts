import { createFileRoute } from "@tanstack/react-router";
import { ideasPath, ideasViewCookie, isIdeasView } from "../ideas-view.ts";

// "Make X the default" on the Ideas page posts here: it keeps the view in a cookie for a year and goes
// back to the board, which then opens in it. The page's script sets the same cookie itself and skips the
// round trip; this is for a page that has not hydrated yet. A view preference, like /layout, so no login
// and no origin check.
export const Route = createFileRoute("/ideas/default")({
  server: {
    handlers: {
      GET: () => new Response("not found", { status: 404 }),
      POST: async ({ request }) => {
        const form = await request.formData();
        const view = form.get("view");
        const headers = new Headers({ location: ideasPath(form, ["radar", "category"]), "cache-control": "no-store" });
        if (isIdeasView(view)) headers.append("set-cookie", ideasViewCookie(view));
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
