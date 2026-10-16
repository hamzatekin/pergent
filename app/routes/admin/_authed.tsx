import { Link, Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { getAdminSession } from "../../server/admin.functions.ts";

// The dashboard's pages: only with ADMIN_PASSWORD set (otherwise 404) and the cookie (otherwise the
// login, which comes back here). Styled by the .admin rules in styles.css.
export const Route = createFileRoute("/admin/_authed")({
  beforeLoad: async ({ location }) => {
    const session = await getAdminSession();
    if (!session.enabled) throw notFound();
    if (!session.loggedIn) throw redirect({ to: "/admin/login", search: { next: location.pathname, failed: undefined } });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: () => (
    <div className="page admin">
      <header className="topbar">
        <nav className="tabs">
          <Link to="/admin" className="tab" activeOptions={{ exact: true }} activeProps={{ "data-active": "true" } as object}>
            Runs
          </Link>
          <a href="/read" className="tab">
            Paper
          </a>
        </nav>
        <form method="post" action="/admin/logout">
          <button type="submit" className="linkbtn">
            Log out
          </button>
        </form>
      </header>
      <Outlet />
    </div>
  ),
});
