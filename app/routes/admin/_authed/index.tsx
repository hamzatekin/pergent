import { Link, createFileRoute } from "@tanstack/react-router";
import { Badge, useRefreshWhile } from "../../../components/Admin.tsx";
import { getDashboard } from "../../../server/admin.functions.ts";

// /admin: a card per task with its Run now button, and the latest 100 runs.
export const Route = createFileRoute("/admin/_authed/")({
  loader: () => getDashboard(),
  head: () => ({ meta: [{ title: "Runs · pergent admin" }] }),
  component: Dashboard,
});

function Dashboard() {
  const d = Route.useLoaderData();
  useRefreshWhile(d.anyRunning);
  return (
    <>
      <p className="note">
        Scheduler {d.scheduler}
        {d.lastRead && ` · paper last read ${d.lastRead}`}
        {d.anyRunning && " · this page refreshes while a run is going"}
      </p>
      <div className="task-cards">
        {d.cards.map((c) => (
          <div key={c.task} className="task-card">
            <div className="task-card-head">
              <h2>{c.task}</h2>
              <form method="post" action={`/admin/run/${encodeURIComponent(c.task)}`}>
                <button type="submit" className="btn" disabled={c.busy}>
                  {c.busy ? "Running…" : "Run now"}
                </button>
              </form>
            </div>
            <dl className="stats">
              <div>
                <dt>Last run</dt>
                <dd>{c.last ? <><Badge status={c.last.status} /> {c.last.ago}</> : "never"}</dd>
              </div>
              <div>
                <dt>Avg cost (last {c.avgOf})</dt>
                <dd>{c.avgCost}</dd>
              </div>
              <div>
                <dt>Last 30 days</dt>
                <dd>{c.month}</dd>
              </div>
              {c.muted !== undefined && (
                <div>
                  <dt>Never show</dt>
                  <dd>
                    <Link to="/admin/mutes/$task" params={{ task: c.task }}>
                      {c.muted} muted
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="runs">
          <thead>
            <tr>
              <th>Started</th>
              <th>Task</th>
              <th>Status</th>
              <th className="num wide">Turns</th>
              <th className="num wide">Time</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={`${r.task}/${r.runId}`}>
                <td>
                  <Link to="/admin/runs/$task/$runId" params={{ task: r.task, runId: r.runId }}>
                    {r.started}
                  </Link>
                </td>
                <td>{r.task}</td>
                <td>
                  <Badge status={r.status} />
                </td>
                <td className="num wide">{r.turns ?? ""}</td>
                <td className="num wide">{r.time}</td>
                <td className="num">{r.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!d.rows.length && <p className="note">No runs yet.</p>}
    </>
  );
}
