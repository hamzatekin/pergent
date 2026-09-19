const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Turn a 5-field cron string into plain English. Falls back to the raw string for anything unusual. */
export function describeCron(cron: string | undefined): string {
  if (!cron) return "manual";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  const stepMin = step(min);
  const stepHour = hour === "*" ? 1 : step(hour);

  // Every N minutes / hours
  if (stepMin !== null && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return stepMin === 1 ? "every minute" : `every ${stepMin} minutes`;
  }
  if (stepHour !== null && dom === "*" && mon === "*" && dow === "*") {
    const at = isNum(min) && Number(min) > 0 ? ` at :${pad(min)}` : "";
    return stepHour === 1 ? `hourly${at}` : `every ${stepHour} hours${at}`;
  }

  if (!isNum(min) || !isNum(hour)) return cron;
  const time = ` at ${formatTime(Number(hour), Number(min))}`;

  const days = dayList(dow);
  if (dom === "*" && mon === "*") {
    if (dow === "*") return `daily${time}`;
    if (days === null) return cron;
    if (sameSet(days, [1, 2, 3, 4, 5])) return `weekdays${time}`;
    if (sameSet(days, [0, 6])) return `weekends${time}`;
    return `every ${days.map((d) => DAYS[d]).join(", ")}${time}`;
  }

  if (dow === "*" && isNum(dom)) {
    const day = ordinal(Number(dom));
    if (mon === "*") return `monthly on the ${day}${time}`;
    if (isNum(mon)) return `yearly on ${MONTHS[Number(mon) - 1]} ${day}${time}`;
  }

  return cron;
}

function isNum(s: string) {
  return /^\d+$/.test(s);
}

function pad(s: string) {
  return s.padStart(2, "0");
}

function step(field: string): number | null {
  if (field === "*") return null;
  const m = /^\*\/(\d+)$/.exec(field);
  return m ? Number(m[1]) : null;
}

function formatTime(h: number, m: number) {
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Expand a day-of-week field like "1-5", "1,3,5", "MON-FRI" into numbers; null if unsupported. */
function dayList(field: string): number[] | null {
  if (field === "*") return null;
  const names: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const toNum = (s: string) => {
    const n = names[s.toLowerCase()] ?? (isNum(s) ? Number(s) % 7 : NaN);
    return Number.isNaN(n) ? null : n;
  };
  const out: number[] = [];
  for (const chunk of field.split(",")) {
    const range = chunk.split("-");
    if (range.length === 1) {
      const n = toNum(range[0]);
      if (n === null) return null;
      out.push(n);
    } else if (range.length === 2) {
      const a = toNum(range[0]);
      const b = toNum(range[1]);
      if (a === null || b === null || a > b) return null;
      for (let d = a; d <= b; d++) out.push(d);
    } else return null;
  }
  return [...new Set(out)].sort();
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
