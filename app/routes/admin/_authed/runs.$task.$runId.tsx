import { createFileRoute } from "@tanstack/react-router";
import { Badge, useRefreshWhile } from "../../../components/Admin.tsx";
import { getRunDetail } from "../../../server/admin.functions.ts";

// One run: status, cost by model and tokens from the result event, before.log, stderr.log, the steps of
// log.jsonl, and every file in the run directory as plain text.
export const Route = createFileRoute("/admin/_authed/runs/$task/$runId")({
  loader: ({ params }) => getRunDetail({ data: params }),
  head: ({ params }) => ({ meta: [{ title: `${params.task} ${params.runId} · pergent admin` }] }),
  component: RunDetail,
});

function RunDetail() {
  const r = Route.useLoaderData();
  useRefreshWhile(r.busy);
  const file = (f: string) => `/admin/runs/${encodeURIComponent(r.task)}/${encodeURIComponent(r.runId)}/files/${encodeURIComponent(f)}`;
  return (
    <>
      <h1 className="admin-title">
        {r.task} · {r.started}
      </h1>
      <dl className="stats">
        <div>
          <dt>Status</dt>
          <dd>
            <Badge status={r.status} />
            {r.timedOut && " (timed out)"}
            {r.exitCode ? ` (exit ${r.exitCode})` : ""}
          </dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{r.cost}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{r.turns}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{r.time}</dd>
        </div>
      </dl>
      <p className="note">
        {r.ok && (
          <>
            <a href={`/read/${encodeURIComponent(r.task)}/${encodeURIComponent(r.runId)}`}>Read the paper</a> ·{" "}
          </>
        )}
        Files:{" "}
        {r.files.length
          ? r.files.map((f, i) => (
              <span key={f}>
                {i > 0 && ", "}
                <a href={file(f)}>{f}</a>
              </span>
            ))
          : "none"}
      </p>
      {r.models.length > 0 && (
        <>
          <h2 className="admin-head">Cost by model</h2>
          <div className="table-wrap">
            <table className="runs">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Input</th>
                  <th className="num">Cache write</th>
                  <th className="num">Cache read</th>
                  <th className="num">Output</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {r.models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td className="num">{m.input}</td>
                    <td className="num">{m.cacheWrite}</td>
                    <td className="num">{m.cacheRead}</td>
                    <td className="num">{m.output}</td>
                    <td className="num">{m.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {r.before && (
        <>
          <h2 className="admin-head">before.log</h2>
          <pre className="log">{r.before}</pre>
        </>
      )}
      {r.stderr && (
        <>
          <h2 className="admin-head">stderr.log</h2>
          <pre className="log">{r.stderr}</pre>
        </>
      )}
      <h2 className="admin-head">Steps ({r.steps.length})</h2>
      {r.steps.length ? (
        <ol className="trace">
          {r.steps.map((s, i) => (
            <li key={i} className="step">
              <span className={`step-kind${s.kind === "tool" ? " tool" : ""}${s.error ? " failed" : ""}`}>
                {s.kind === "tool" ? s.name : s.kind}
                {s.t !== undefined && <span className="step-time"> {s.t}s</span>}
              </span>
              <div className={`step-body${s.kind === "result" ? " muted" : ""}`}>{s.text}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">Nothing in log.jsonl yet.</p>
      )}
    </>
  );
}
