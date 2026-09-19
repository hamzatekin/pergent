import { useEffect, useState } from "react";
import { marked } from "marked";
import { api, type Run, type RunMeta, type Task } from "./api.ts";
import { describeCron } from "./cron.ts";
import { ReadView } from "./Read.tsx";
import { Link, usePath } from "./router.tsx";

const button =
  "rounded-md border border-line bg-surface px-3 py-1.5 font-medium transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-default";
const selectable = "rounded-md transition-colors hover:bg-surface data-[active=true]:bg-surface data-[active=true]:shadow-[inset_0_0_0_1px_var(--color-line)]";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const path = usePath();

  useEffect(() => {
    api.tasks().then((list) => {
      setTasks(list);
      setSelected((s) => s ?? list[0]?.name ?? null);
    });
  }, []);

  // /read, /read/<task>, /read/<task>/<runId>: the distraction-free reading view.
  const read = path.match(/^\/read(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
  if (read) {
    const name = read[1] ?? tasks[0]?.name;
    return name ? <ReadView key={name} tasks={tasks} task={name} runId={read[2]} /> : null;
  }

  const task = tasks.find((t) => t.name === selected);

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[200px_1fr]">
      <nav className="flex flex-row gap-0.5 overflow-x-auto border-b border-line px-2 py-3 md:flex-col md:border-r md:border-b-0 md:px-2 md:py-4">
        <div className="hidden px-2 pb-4 pt-1 font-semibold tracking-tight md:block">pergent</div>
        {tasks.map((t) => (
          <button
            key={t.name}
            className={`flex shrink-0 flex-col px-2 py-1.5 ${selectable}`}
            data-active={t.name === selected}
            onClick={() => setSelected(t.name)}
          >
            {t.name}
            <span className="text-xs text-muted">{describeCron(t.config.schedule)}</span>
          </button>
        ))}
      </nav>
      <main className="flex min-w-0 flex-col gap-7 px-4 py-5 md:px-8 md:py-6">
        {task && (
          <TaskView
            key={task.name}
            task={task}
            onSaved={(saved) => setTasks((all) => all.map((t) => (t.name === saved.name ? saved : t)))}
          />
        )}
      </main>
    </div>
  );
}

function TaskView({ task, onSaved }: { task: Task; onSaved: (task: Task) => void }) {
  const [prompt, setPrompt] = useState(task.prompt);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = prompt !== task.prompt;
  const busy = runs.some((r) => r.status === "running");

  const refresh = () =>
    api.runs(task.name).then((list) => {
      setRuns(list);
      setRunId((id) => id ?? list[0]?.runId ?? null);
    });

  useEffect(() => {
    refresh();
  }, [task.name]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [busy, task.name]);

  async function save() {
    onSaved(await api.saveTask(task.name, { config: task.config, prompt }));
  }

  async function start() {
    setError(null);
    try {
      if (dirty) await save();
      await api.start(task.name);
      await refresh();
      setRunId(null);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{task.name}</h1>
          <div className="text-muted">
            {[describeCron(task.config.schedule), task.config.model, task.config.allowedTools?.join(", ")].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/read/${task.name}`} className={button}>
            Read
          </Link>
          {dirty && (
            <button className={button} onClick={save}>
              Save
            </button>
          )}
          <button className={`${button} border-accent bg-accent text-accent-text`} onClick={start} disabled={busy}>
            {busy ? "Running…" : "Run now"}
          </button>
        </div>
      </header>
      {error && <div className="text-[13px] text-failed">{error}</div>}

      <section>
        <SectionTitle>Prompt</SectionTitle>
        <textarea
          className="min-h-44 w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-[13px] leading-normal outline-none transition-colors focus:border-muted"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
        />
      </section>

      <section className="grid items-start gap-6 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-0.5">
          <SectionTitle>Runs</SectionTitle>
          {runs.length === 0 && <div className="text-muted">No runs yet.</div>}
          {runs.map((r) => (
            <button
              key={r.runId}
              className={`grid grid-cols-[auto_1fr] items-center gap-x-2 px-2 py-1.5 ${selectable}`}
              data-active={r.runId === runId}
              onClick={() => setRunId(r.runId)}
            >
              <span
                className="size-[7px] rounded-full bg-muted data-[status=ok]:bg-ok data-[status=failed]:bg-failed data-[status=running]:bg-running"
                data-status={r.status}
              />
              <span>{formatDate(r.startedAt)}</span>
              <span className="col-start-2 text-xs text-muted">
                {r.status === "running" ? "running" : `${r.turns ?? "?"} turns · $${(r.costUsd ?? 0).toFixed(2)}`}
              </span>
            </button>
          ))}
        </div>
        {runId && <RunView key={runId} task={task.name} runId={runId} live={runs.find((r) => r.runId === runId)?.status === "running"} />}
      </section>
    </>
  );
}

function RunView({ task, runId, live }: { task: string; runId: string; live?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<"output" | "log">("output");

  useEffect(() => {
    const load = () => api.run(task, runId).then(setRun);
    load();
    if (!live) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [task, runId, live]);

  if (!run) return null;
  const failed = run.meta.status === "failed";

  return (
    <div className="min-w-0">
      <div className="mb-3 flex gap-1">
        {(["output", "log"] as const).map((t) => (
          <button
            key={t}
            className={`px-2.5 py-1 font-medium capitalize text-muted data-[active=true]:text-ink ${selectable}`}
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "output" ? (
        run.output ? (
          <article className="output py-1" dangerouslySetInnerHTML={{ __html: marked.parse(run.output) as string }} />
        ) : (
          <div className="text-muted">{live ? "Waiting for output…" : failed ? "Run failed. Check the log." : "No output."}</div>
        )
      ) : (
        <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-normal">
          {(run.before ? `--- before ---\n${run.before}\n\n` : "") + formatLog(run.log) + (run.stderr ? `\n--- stderr ---\n${run.stderr}` : "")}
        </pre>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{children}</h2>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Compress the stream-json log to one readable line per event.
function formatLog(log: string) {
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const e = JSON.parse(line);
        if (e.type === "assistant") {
          return e.message.content
            .map((c: any) => (c.type === "text" ? c.text : `→ ${c.name}(${JSON.stringify(c.input)})`))
            .join("\n");
        }
        if (e.type === "user") {
          return e.message.content
            .map((c: any) => (c.type === "tool_result" ? `← ${truncate(contentText(c.content))}` : ""))
            .join("\n");
        }
        if (e.type === "result") return `■ ${e.subtype} · ${e.num_turns} turns · $${e.total_cost_usd?.toFixed(3)}`;
        return `· ${e.type}`;
      } catch {
        return line;
      }
    })
    .join("\n\n");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === "text" ? c.text : "")).join("");
  return JSON.stringify(content);
}

function truncate(s: string, max = 400) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
