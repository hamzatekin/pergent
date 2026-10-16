import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { PaperPage as Data } from "../server/read.functions.ts";
import { Paper } from "./Paper.tsx";
import { Topbar } from "./Topbar.tsx";

// The reading view: task tabs, the older and newer runs either side of the run's date, the notes, and
// the paper. ← and → step between runs. Opening a run is the read that keeps the scheduler alive.
export function PaperPage({ data }: { data: Data }) {
  const navigate = useNavigate();
  const { task, older, newer } = data;
  const runId = data.run?.runId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const to = e.key === "ArrowLeft" ? older : e.key === "ArrowRight" ? newer : undefined;
      if (to) navigate({ to: "/read/{-$task}/{-$runId}", params: { task, runId: to } });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [navigate, task, older, newer]);

  useEffect(() => {
    if (runId) fetch("/api/read", { method: "POST" }).catch(() => {});
  }, [task, runId]);

  return (
    <div className="page">
      <Topbar hides>
        <nav className="tabs">
          {data.tabs.map((t) => (
            <Link key={t.name} to="/read/{-$task}/{-$runId}" params={{ task: t.name, runId: undefined }} className="tab" data-active={t.name === task}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="runnav">
          <RunArrow task={task} runId={older} label="Older run" glyph="←" keyName="ArrowLeft" />
          <span className="stamp">{data.run?.stamp}</span>
          <RunArrow task={task} runId={newer} label="Newer run" glyph="→" keyName="ArrowRight" />
        </div>
      </Topbar>
      {data.notes.map((note, i) => (
        <p key={i} className={note.kind === "failed" ? "note failed" : "note"}>
          {note.kind === "paused" &&
            `Scheduled runs were paused: ${note.lastReadDays === null ? "the paper had not been opened yet" : `the paper was last read ${note.lastReadDays} days ago`}. Reading it turns them back on.`}
          {note.kind === "none" && "No finished runs yet."}
          {note.kind === "failed" && "This run failed."}
          {note.kind === "empty" && "This run produced no output."}
          {note.kind === "hidden" && (
            <>
              {note.count} {note.count === 1 ? "story" : "stories"} hidden by your <a href={`/admin/mutes/${note.task}`}>never-show list</a>.
            </>
          )}
        </p>
      ))}
      {data.paper && <Paper paper={data.paper} labels={{ contextLabel: data.contextLabel, briefsLabel: data.briefsLabel }} />}
    </div>
  );
}

function RunArrow({ task, runId, label, glyph, keyName }: { task: string; runId?: string; label: string; glyph: string; keyName: string }) {
  const title = `${label} (${keyName})`;
  if (!runId) {
    return (
      <a className="arrow" aria-disabled="true" aria-label={label} title={title}>
        {glyph}
      </a>
    );
  }
  return (
    <Link to="/read/{-$task}/{-$runId}" params={{ task, runId }} className="arrow" aria-label={label} title={title}>
      {glyph}
    </Link>
  );
}
