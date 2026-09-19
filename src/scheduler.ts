import { getState, lastRunStartedAt, setState } from "./db.ts";
import { listTasks, loadTask } from "./runner.ts";

// Dead man's switch: scheduled runs only happen while someone is reading the paper. The server
// records every run the UI fetches as a read; after PAUSE_AFTER_DAYS without one the scheduler
// stops starting tasks, and the next read turns it back on. A fresh database has no read yet,
// so a new deployment stays quiet until the paper is opened once.
export const PAUSE_AFTER_DAYS = Number(process.env.SCHEDULER_PAUSE_DAYS ?? 7);

export function lastReadAt(): string | null {
  return getState("last_read");
}

export function markRead() {
  setState("last_read", new Date().toISOString());
}

export function paused(now = Date.now()): boolean {
  const read = lastReadAt();
  return !read || now - Date.parse(read) > PAUSE_AFTER_DAYS * 86_400_000;
}

// Five-field cron (minute hour day-of-month month day-of-week) with *, lists, ranges and steps,
// matched against local time (TZ). Day-of-month and day-of-week are OR-ed when both are restricted,
// like Vixie cron.
function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, step = "1"] = part.split("/");
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b ?? (part.includes("/") ? max : a);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || !Number.isInteger(Number(step)) || Number(step) < 1) throw new Error(`bad cron field: ${spec}`);
    for (let v = lo; v <= hi; v += Number(step)) out.add(v);
  }
  return out;
}

export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`bad cron: ${expr}`);
  const [minute, hour, dom, month, dow] = parts;
  if (!field(minute, 0, 59).has(date.getMinutes())) return false;
  if (!field(hour, 0, 23).has(date.getHours())) return false;
  if (!field(month, 1, 12).has(date.getMonth() + 1)) return false;
  const domOk = field(dom, 1, 31).has(date.getDate());
  const days = field(dow, 0, 7);
  const dowOk = days.has(date.getDay()) || (date.getDay() === 0 && days.has(7));
  return dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk;
}

// Ticks just after every minute boundary. A task whose latest run started in this same minute is
// skipped, so a restart mid-minute does not fire it twice. `start` is the server's run trigger,
// which already refuses to overlap a running task.
export function startScheduler(start: (name: string) => void) {
  const tick = async () => {
    const now = new Date();
    if (paused(now.getTime())) return;
    for (const name of await listTasks()) {
      try {
        const { config } = await loadTask(name);
        if (!config.schedule || !cronMatches(config.schedule, now)) continue;
        const last = lastRunStartedAt(name);
        if (last && Math.floor(Date.parse(last) / 60_000) === Math.floor(now.getTime() / 60_000)) continue;
        console.log(`schedule: starting ${name} (${config.schedule})`);
        start(name);
      } catch (err) {
        console.error(`schedule: ${name}:`, err);
      }
    }
  };
  const arm = () => setTimeout(() => tick().catch(console.error).finally(arm), 60_000 - (Date.now() % 60_000) + 50);
  arm();
  console.log(`scheduler on: pauses after ${PAUSE_AFTER_DAYS} days without a read${paused() ? " (paused now)" : ""}`);
}
