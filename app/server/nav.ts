import { listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { schedulerStatus } from "#src/scheduler.ts";
import { PASSWORD, loggedIn } from "./admin.ts";

export type Nav = {
  tabs: { name: string; label: string; icon?: string }[];
  scheduler: "off" | "on" | "paused";
  admin: boolean;
  /** The Newsletters page, the issues as published: there for a visitor with the admin cookie. */
  newsletters: boolean;
  /** The Ideas page, the radar's problems (tasks/ideas): likewise. */
  ideas: boolean;
  /** The Jobs page, the job market tracker's adverts (tasks/jobs-collect): likewise. */
  jobs: boolean;
};

// What the sidebar shows on every page: a link per task in tab order (not a task with `tab: false`), the scheduler's state at the
// foot, and the dashboard's link when ADMIN_PASSWORD makes it exist. The configs come along for the
// paper page, which needs its own task's.
export async function nav(): Promise<Nav & { configs: Map<string, TaskConfig> }> {
  const all = await listTasks();
  const configs = new Map(await Promise.all(all.map(async (t) => [t, await loadTask(t).then((x) => x.config, () => ({}) as TaskConfig)] as const)));
  return {
    tabs: all
      .filter((t) => configs.get(t)!.tab !== false)
      .map((t) => {
        const c = configs.get(t)!;
        return { name: t, label: c.label ?? t, icon: c.icon };
      }),
    scheduler: schedulerStatus().scheduler,
    admin: !!PASSWORD,
    newsletters: loggedIn(),
    ideas: loggedIn() && all.includes("ideas"),
    jobs: loggedIn() && all.includes("jobs-collect"),
    configs,
  };
}
