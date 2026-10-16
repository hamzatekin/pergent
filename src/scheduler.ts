import { getState, runsSince, setState } from "./db.ts";
import { listTasks, loadTask, runTask } from "./runner.ts";

// Only the container sets SCHEDULER=1; a local server never starts runs by itself.
export const SCHEDULER = process.env.SCHEDULER === "1";

// The runs this server process has going or waiting, one per task. The scheduler and the dashboard's
// Run now both start runs here, so a task never runs twice at once from the server (the CLI does not
// see it). At most MAX_RUNS go at once and the rest wait their turn in order: every run is a claude
// process inside the container's 2 CPUs and 2 GB, and tasks that share a minute would otherwise all
// start together.
const MAX_RUNS = 2;
const running = new Set<string>();
const waiting: string[] = [];
let going = 0;

export function startRun(name: string): boolean {
  if (running.has(name)) return false;
  running.add(name);
  waiting.push(name);
  next();
  return true;
}

function next() {
  while (going < MAX_RUNS && waiting.length) {
    const name = waiting.shift()!;
    going++;
    runTask(name)
      .catch((err) => console.error(`run ${name} failed:`, err))
      .finally(() => {
        running.delete(name);
        going--;
        next();
      });
  }
}

export const isRunning = (name: string) => running.has(name);
// Started but not yet going: waiting for one of the MAX_RUNS places.
export const isWaiting = (name: string) => waiting.includes(name);

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

export function schedulerStatus() {
  return { scheduler: !SCHEDULER ? "off" : paused() ? "paused" : "on", lastReadAt: lastReadAt(), pauseAfterDays: PAUSE_AFTER_DAYS } as const;
}

// Five-field cron (minute hour day-of-month month day-of-week) with *, lists, ranges and steps,
// matched against wall-clock time in `timeZone` (an IANA name from the task's config) or, without one,
// the process's local time (TZ). Day-of-month and day-of-week are OR-ed when both are restricted, like
// Vixie cron.
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formats = new Map<string, Intl.DateTimeFormat>();

function wallClock(date: Date, timeZone?: string) {
  if (!timeZone) {
    return { minute: date.getMinutes(), hour: date.getHours(), day: date.getDate(), month: date.getMonth() + 1, weekday: date.getDay() };
  }
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short" });
    formats.set(timeZone, format);
  }
  const p = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  return { minute: Number(p.minute), hour: Number(p.hour), day: Number(p.day), month: Number(p.month), weekday: WEEKDAYS.indexOf(p.weekday) };
}

export function cronMatches(expr: string, date: Date, timeZone?: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`bad cron: ${expr}`);
  const [minute, hour, dom, month, dow] = parts;
  const now = wallClock(date, timeZone);
  if (!field(minute, 0, 59).has(now.minute)) return false;
  if (!field(hour, 0, 23).has(now.hour)) return false;
  if (!field(month, 1, 12).has(now.month)) return false;
  const domOk = field(dom, 1, 31).has(now.day);
  const days = field(dow, 0, 7);
  const dowOk = days.has(now.weekday) || (now.weekday === 0 && days.has(7));
  return dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk;
}

// The most recent minute at or before `now` that the cron matched, looking back `windowMinutes`;
// null when it did not fire in that window.
export function lastSlot(expr: string, now: Date, timeZone?: string, windowMinutes = 24 * 60): Date | null {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i < windowMinutes; i++) {
    const at = new Date(minute - i * 60_000);
    if (cronMatches(expr, at, timeZone)) return at;
  }
  return null;
}

// Ticks just after every minute boundary. A task is due when its cron fired within the last 24h and
// no run of it (any status) has started since that slot. This is what fires it at the scheduled
// minute, and it is also the catch-up: a server that was down, deploying or paused at 7:30 starts
// the task on its first tick after, and a run that already happened (or failed) is not repeated.
// The one exception is a run a restart cut off (failed with no finish time, see closeStaleRuns): a
// deploy in the middle of a run would otherwise lose the day's paper, so the task gets one more run.
// startRun refuses to overlap a task that is already running or waiting.
export function startScheduler() {
  const tick = async () => {
    const now = new Date();
    if (paused(now.getTime())) return;
    for (const name of await listTasks()) {
      try {
        const { config } = await loadTask(name);
        if (!config.schedule) continue;
        const slot = lastSlot(config.schedule, now, config.timezone);
        if (!slot) continue;
        const since = runsSince(name, slot.toISOString());
        const retry = since.length === 1 && since[0].status === "failed" && !since[0].finishedAt;
        if (since.length && !retry) continue;
        if (startRun(name)) console.log(`schedule: starting ${name} (${config.schedule} ${config.timezone ?? "local"}, slot ${slot.toISOString()}${retry ? ", retry after restart" : ""})`);
      } catch (err) {
        console.error(`schedule: ${name}:`, err);
      }
    }
  };
  const arm = () => setTimeout(() => tick().catch(console.error).finally(arm), 60_000 - (Date.now() % 60_000) + 50);
  arm();
  console.log(`scheduler on: pauses after ${PAUSE_AFTER_DAYS} days without a read${paused() ? " (paused now)" : ""}`);
}
