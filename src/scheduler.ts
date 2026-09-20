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
// its latest run (any status) started before that slot. This is what fires it at the scheduled
// minute, and it is also the catch-up: a server that was down, deploying or paused at 7:30 starts
// the task on its first tick after, and a run that already happened (or failed) is not repeated.
// `start` is the server's run trigger, which already refuses to overlap a running task.
export function startScheduler(start: (name: string) => void) {
  const tick = async () => {
    const now = new Date();
    if (paused(now.getTime())) return;
    for (const name of await listTasks()) {
      try {
        const { config } = await loadTask(name);
        if (!config.schedule) continue;
        const slot = lastSlot(config.schedule, now, config.timezone);
        if (!slot) continue;
        const last = lastRunStartedAt(name);
        if (last && Date.parse(last) >= slot.getTime()) continue;
        console.log(`schedule: starting ${name} (${config.schedule} ${config.timezone ?? "local"}, slot ${slot.toISOString()})`);
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
