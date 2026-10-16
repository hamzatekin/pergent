import { listTasks, loadTask, type TaskConfig } from "#src/runner.ts";
import { schedulerStatus } from "#src/scheduler.ts";
import { PASSWORD } from "./admin.ts";

export type Nav = {
  tabs: { name: string; label: string; icon?: string }[];
  scheduler: "off" | "on" | "paused";
  admin: boolean;
};

// What the sidebar shows on every page: a link per task in tab order, the scheduler's state at the
// foot, and the dashboard's link when ADMIN_PASSWORD makes it exist. The configs come along for the
// paper page, which needs its own task's.
export async function nav(): Promise<Nav & { configs: Map<string, TaskConfig> }> {
  const tasks = await listTasks();
  const configs = new Map(await Promise.all(tasks.map(async (t) => [t, await loadTask(t).then((x) => x.config, () => ({}) as TaskConfig)] as const)));
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
