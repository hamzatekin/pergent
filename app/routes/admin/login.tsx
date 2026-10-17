import { createFileRoute, notFound } from "@tanstack/react-router";
import { adminPath, guardPost, passwordMatches, seeOther, sessionCookie } from "../../server/admin.ts";
import { getAdminSession } from "../../server/admin.functions.ts";

// The login form posts here; a wrong password waits a second (slows down guessing) and comes back with
// a note. Logging in returns to the /admin page, or the private paper, that sent you here (`next`).
export const Route = createFileRoute("/admin/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
    failed: search.failed !== undefined ? true : undefined,
  }),
  beforeLoad: async () => {
    if (!(await getAdminSession()).enabled) throw notFound();
  },
  head: () => ({ meta: [{ title: "Log in · pergent admin" }, { name: "robots", content: "noindex" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        const refused = guardPost(request, { login: true });
        if (refused) return refused;
        const form = await request.formData();
        const next = adminPath(String(form.get("next") ?? ""));
        if (!passwordMatches(String(form.get("password") ?? ""))) {
          await new Promise((done) => setTimeout(done, 1000));
          return seeOther(`/admin/login?failed=1&next=${encodeURIComponent(next)}`);
        }
        return seeOther(next, [sessionCookie(request)]);
      },
    },
  },
  component: Login,
});

function Login() {
  const { next, failed } = Route.useSearch();
  return (
    <div className="login-page">
      <form method="post" action="/admin/login" className="login">
        <img src="/icon.svg" alt="" className="login-mark" />
        <h1 className="admin-title">Log in to pergent</h1>
        {failed && <p className="note failed">Wrong password.</p>}
        <input type="hidden" name="next" value={next && /^\/(admin|read|newsletters)(\/|$)/.test(next) ? next : "/admin"} />
        <input type="password" name="password" autoComplete="current-password" placeholder="Password" autoFocus required />
        <button type="submit" className="btn primary">
          Log in
        </button>
      </form>
    </div>
  );
}
