import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { listRuns, listTasks, loadTask, readRun } from "#src/runner.ts";
import { listMutes } from "#src/db.ts";
import { hideMuted } from "#src/mute.ts";
import { schedulerStatus } from "#src/scheduler.ts";
import type { Story } from "#src/paper.ts";
import { paperView, type PaperView, type StoryActions } from "./paper-view.ts";
import { newspaperView, type NewspaperView } from "./newspaper-view.ts";
import { daysAgo, formatDate } from "./format.ts";
import { nav, type Nav } from "./nav.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { canSaveNotes } from "./notes.ts";
import { taskSources, type TaskSources } from "#src/sources.ts";

export type Note =
  | { kind: "paused"; lastReadDays: number | null }
  | { kind: "none" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "hidden"; count: number; task: string };

export type PaperPage = {
  nav: Nav;
  task: string;
  label: string;
  lang: string;
  contextLabel?: string;
  briefsLabel?: string;
  run?: { runId: string; stamp: string };
  older?: string;
  newer?: string;
  notes: Note[];
  /** The paper's title, for the page's <title>, whichever layout it is in. */
  title?: string;
  paper?: PaperView;
  newspaper?: NewspaperView;
  /** What the task reads and how its paper is made, for the closed Sources panel above the paper. */
  sources: TaskSources;
};

// The reading page: a task's run (by default its latest ok one), the tabs, the older and newer runs,
// and the notes above the paper. Rendering it is not a read for the scheduler; the page's script marks
// the read (/api/read), so a crawler cannot keep a forgotten deployment running.
export const getPaperPage = createServerFn({ method: "GET" })
  .validator((data: { task?: string; runId?: string }) => data)
  .handler(async ({ data }): Promise<PaperPage> => {
    const { configs, ...sidebar } = await nav();
    const task = data.task ?? sidebar.tabs[0]?.name;
    if (!task || !configs.has(task)) {
      // A private task's page sends a visitor without the cookie to the login, which comes back here.
      if (task && PASSWORD && (await listTasks()).includes(task) && (await loadTask(task)).config.private)
        throw redirect({ to: "/admin/login", search: { next: `/read/${task}${data.runId ? `/${data.runId}` : ""}`, failed: undefined } });
      throw notFound();
    }
    const config = configs.get(task)!;
    // The front page and the pages differ by cookie now; a private paper is never kept by a cache.
    if (config.private) setResponseHeader("cache-control", "private, no-store");
    const finished = listRuns(task).filter((r) => r.status !== "running");
    const current = data.runId ? finished.find((r) => r.runId === data.runId) : (finished.find((r) => r.status === "ok") ?? finished[0]);
    if (data.runId && !current) throw notFound();
    const index = current ? finished.indexOf(current) : -1;
    const run = current ? readRun(task, current.runId) : null;

    const notes: Note[] = [];
    const status = schedulerStatus();
    if (status.scheduler === "paused") notes.push({ kind: "paused", lastReadDays: status.lastReadAt ? daysAgo(status.lastReadAt) : null });
    if (!current) notes.push({ kind: "none" });
    if (current?.status === "failed") notes.push({ kind: "failed" });
    if (run && current?.status === "ok" && !run.paper.sections.length) notes.push({ kind: "empty" });

    // A task with a never-show list hides the stories that match it, and gives each story the link that
    // adds to it; logged in, every story of a public paper can be saved to the notes. Both name the story
    // by where it sits in the stored paper.
    let paper: PaperView | undefined;
    let newspaper: NewspaperView | undefined;
    if (run) {
      const places = new Map<Story, string>();
      run.paper.sections.forEach((s, i) => s.stories.forEach((story, j) => places.set(story, `${task}/${current!.runId}/${i}/${j}`)));
      let shown = run.paper;
      if (config.mute) {
        const muted = hideMuted(run.paper, listMutes(task));
        shown = muted.paper;
        if (muted.hidden) notes.push({ kind: "hidden", count: muted.hidden, task });
      }
      const saving = canSaveNotes() && !config.private && loggedIn();
      const actions: StoryActions = (story) => ({
        mute: config.mute ? `/admin/mute/${places.get(story)}` : undefined,
        save: saving ? places.get(story) : undefined,
      });
      if (config.newspaper) {
        // The issue number counts the task's good papers up to this one.
        const issue = finished.filter((r) => r.status === "ok" && r.startedAt <= current!.startedAt).length;
        const meta = { config: config.newspaper!, startedAt: current!.startedAt, timezone: config.timezone, lang: config.lang ?? "en", issue, costUsd: current!.costUsd };
        newspaper = newspaperView(shown, run.images, meta, actions);
      } else paper = paperView(shown, run.images, actions);
    }

    return {
      nav: sidebar,
      task,
      label: config.label ?? task,
      lang: config.lang ?? "en",
      contextLabel: config.contextLabel,
      briefsLabel: config.briefsLabel,
      run: current && { runId: current.runId, stamp: formatDate(current.startedAt, config.timezone) },
      newer: index > 0 ? finished[index - 1].runId : undefined,
      older: index >= 0 ? finished[index + 1]?.runId : undefined,
      notes,
      title: run?.paper.title,
      paper,
      newspaper,
      // The other papers a task can read (briefings.ts) are the public ones.
      sources: await taskSources(task, config, sidebar.tabs.filter((t) => !configs.get(t.name)?.private)),
    };
  });
