import { listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { schedulerStatus } from "#src/scheduler.ts";
import { PASSWORD, loggedIn } from "./admin.ts";

export type Nav = {
  tabs: { name: string; label: string; icon?: string }[];
  scheduler: "off" | "on" | "paused";
  admin: boolean;
};

// What the sidebar shows on every page: a link per task in tab order, the scheduler's state at the
// foot, and the dashboard's link when ADMIN_PASSWORD makes it exist. A private task (`today`, built
// from the reader's own notes) is only there for a visitor with the admin cookie, and is left out of
// the configs too, so the paper page cannot find it either. The configs come along for the paper page,
// which needs its own task's.
export async function nav(): Promise<Nav & { configs: Map<string, TaskConfig> }> {
  const all = await listTasks();
  const configs = new Map(await Promise.all(all.map(async (t) => [t, await loadTask(t).then((x) => x.config, () => ({}) as TaskConfig)] as const)));
  const admin = loggedIn();
  const tasks = all.filter((t) => admin || !configs.get(t)!.private);
  for (const t of all) if (!tasks.includes(t)) configs.delete(t);
  return {
    tabs: tasks.map((t) => {
      const c = configs.get(t)!;
      return { name: t, label: c.label ?? t, icon: c.icon };
    }),
    scheduler: schedulerStatus().scheduler,
    admin: !!PASSWORD,
    configs,
  };
}
