import { useEffect, useState } from "react";
import { Marked } from "marked";
import { api, type Run, type RunMeta, type Task } from "./api.ts";
import { Link, navigate } from "./router.tsx";

// Bare URLs on their own line (how the prompts ask for sources) render as a small "host ↗" chip
// instead of a wall of link text.
const reader = new Marked({
  renderer: {
    link({ href, text }) {
      if (text !== href) return false;
      let host = href;
      try {
        host = new URL(href).hostname.replace(/^www\./, "");
      } catch {}
      return `<a class="src" href="${href}" target="_blank" rel="noopener">${host} ↗</a>`;
    },
  },
});

const tab = "shrink-0 rounded-md px-2 py-1 transition-colors hover:text-ink data-[active=true]:bg-surface data-[active=true]:text-ink data-[active=true]:shadow-[inset_0_0_0_1px_var(--color-line)]";
const arrow = "rounded-md px-2 py-1 transition-colors hover:text-ink aria-disabled:pointer-events-none aria-disabled:opacity-30";

export function ReadView({ tasks, task, runId }: { tasks: Task[]; task: string; runId?: string }) {
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    setRuns(null);
    api.runs(task).then(setRuns);
  }, [task]);

  const finished = runs?.filter((r) => r.status !== "running") ?? [];
  const current = runId ? finished.find((r) => r.runId === runId) : (finished.find((r) => r.status === "ok") ?? finished[0]);
  const index = current ? finished.indexOf(current) : -1;
  const newer = index > 0 ? finished[index - 1] : null;
  const older = index >= 0 ? finished[index + 1] : null;

  useEffect(() => {
    setRun(null);
    if (current) api.run(task, current.runId).then(setRun);
  }, [task, current?.runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && older) navigate(`/read/${task}/${older.runId}`);
      if (e.key === "ArrowRight" && newer) navigate(`/read/${task}/${newer.runId}`);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [task, older?.runId, newer?.runId]);

  useEffect(() => {
    scrollTo(0, 0);
  }, [task, current?.runId]);

  return (
    <div className="mx-auto max-w-[68ch] px-5 pb-16 pt-4 md:pt-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-muted">
        <nav className="-ml-2 flex min-w-0 gap-0.5 overflow-x-auto">
          {tasks.map((t) => (
            <Link key={t.name} href={`/read/${t.name}`} className={tab} data-active={t.name === task}>
              {t.name}
            </Link>
          ))}
        </nav>
        <div className="-mr-2 flex items-center gap-1">
          <Link href={older ? `/read/${task}/${older.runId}` : "#"} className={arrow} aria-disabled={!older} aria-label="Older run" title="Older (←)">
            ←
          </Link>
          <span className="tabular-nums">{current ? formatDate(current.startedAt) : runs ? "no runs" : ""}</span>
          <Link href={newer ? `/read/${task}/${newer.runId}` : "#"} className={arrow} aria-disabled={!newer} aria-label="Newer run" title="Newer (→)">
            →
          </Link>
          <Link href="/" className={`${arrow} ml-2`}>
            edit
          </Link>
        </div>
      </header>

      {runs && !current && <p className="text-muted">No finished runs yet.</p>}
      {current?.status === "failed" && <p className="mb-6 text-[13px] text-failed">This run failed. Check its log in the editor.</p>}
      {run && run.output && <article className="output read" dangerouslySetInnerHTML={{ __html: reader.parse(run.output) as string }} />}
      {run && !run.output && current?.status === "ok" && <p className="text-muted">This run produced no output.</p>}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
