import { createFileRoute } from "@tanstack/react-router";
import { clearCookies, guardPost, seeOther } from "../../server/admin.ts";

export const Route = createFileRoute("/admin/logout")({
  server: {
    handlers: {
      // Only the form posts here; a GET is not a page.
      GET: () => new Response("not found", { status: 404 }),
      POST: ({ request }) => guardPost(request, { login: true }) ?? seeOther("/admin/login", clearCookies),
    },
  },
});
