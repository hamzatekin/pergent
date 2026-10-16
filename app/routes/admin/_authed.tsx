import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { Icon } from "../../components/Icon.tsx";
import { Shell } from "../../components/Shell.tsx";
import { getAdminSession } from "../../server/admin.functions.ts";
import { getNav } from "../../server/nav.functions.ts";

// The dashboard's pages: only with ADMIN_PASSWORD set (otherwise 404) and the cookie (otherwise the
// login, which comes back here). Styled by the .admin rules in styles.css, inside the same sidebar
// frame as the papers.
export const Route = createFileRoute("/admin/_authed")({
  beforeLoad: async ({ location }) => {
    const session = await getAdminSession();
    if (!session.enabled) throw notFound();
    if (!session.loggedIn) throw redirect({ to: "/admin/login", search: { next: location.pathname, failed: undefined } });
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  loader: () => getNav(),
  component: () => (
    <Shell
      nav={Route.useLoaderData()}
      active="admin"
      header={
        <>
          <p className="crumb">
            <span className="crumb-task">Dashboard</span>
          </p>
          <form method="post" action="/admin/logout">
            <button type="submit" className="btn ghost">
              <Icon name="logout" />
              Log out
            </button>
          </form>
        </>
      }
    >
      <div className="admin">
        <Outlet />
      </div>
    </Shell>
  ),
});
