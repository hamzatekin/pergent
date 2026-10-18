import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { PaperPage as Data } from "../server/read.functions.ts";
import { Icon } from "./Icon.tsx";
import { Newspaper } from "./Newspaper.tsx";
import { Paper } from "./Paper.tsx";
import { Shell } from "./Shell.tsx";
import { Sources } from "./Sources.tsx";

// The reading view: the task's name and the run's date, the older and newer runs, the notes, and the
// paper, inside the sidebar frame. ← and → step between runs. Opening a run is the read that keeps the scheduler alive.
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

  const header = (
    <>
      <h1 className="crumb">
        <span className="crumb-task">{data.label}</span>
        {data.run && <span className="stamp">{data.run.stamp}</span>}
      </h1>
      <div className="runnav">
        <RunArrow task={task} runId={older} label="Older run" glyph="left" keyName="ArrowLeft" />
        <RunArrow task={task} runId={newer} label="Newer run" glyph="right" keyName="ArrowRight" />
      </div>
    </>
  );

  return (
    <Shell nav={data.nav} active={task} header={header}>
      {data.notes.map((note, i) => (
        <p key={i} className="callout" data-kind={note.kind}>
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
      <Sources sources={data.sources} />
      {data.paper && <Paper paper={data.paper} labels={{ contextLabel: data.contextLabel, briefsLabel: data.briefsLabel }} />}
      {data.newspaper && <Newspaper paper={data.newspaper} labels={{ contextLabel: data.contextLabel, briefsLabel: data.briefsLabel }} />}
    </Shell>
  );
}

function RunArrow({ task, runId, label, glyph, keyName }: { task: string; runId?: string; label: string; glyph: string; keyName: string }) {
  const title = `${label} (${keyName})`;
  if (!runId) {
    return (
      <a className="arrow" aria-disabled="true" aria-label={label} title={title}>
        <Icon name={glyph} />
      </a>
    );
  }
  return (
    <Link to="/read/{-$task}/{-$runId}" params={{ task, runId }} className="arrow" aria-label={label} title={title}>
      <Icon name={glyph} />
    </Link>
  );
}
