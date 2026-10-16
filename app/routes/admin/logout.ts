import { createFileRoute } from "@tanstack/react-router";
import { clearCookies, guardPost, seeOther } from "../../server/admin.ts";

export const Route = createFileRoute("/admin/logout")({
  server: {
    handlers: {
      POST: ({ request }) => guardPost(request, { login: true }) ?? seeOther("/admin/login", clearCookies),
    },
  },
});
