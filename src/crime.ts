// How much crime there is around each homes listing, from the police's open data (data.police.uk, no
// key): every street-level crime in England and Wales by month, placed at an anonymised point on or near
// the street, published about two months behind. The area's crimes (a square reaching `radiusKm` from
// the search's centre, which should take in the farthest listing: one past it gets no figure) are fetched
// a month at a time in tiles, since the API refuses an area with more than 10,000 crimes, and kept in the
// crimes table for the newest `months` months. Each listing then gets the crimes within
// `metres` of it over those months, shoplifting left out (it counts shops, not streets), as a yearly
// figure and a level from task.json's `levels`.
import { nowConfig, nowKey } from "./compare.ts";
import { crimeMonths, dropCrimeMonths, getState, homesToScore, loadCrimes, saveCrimeMonth, saveCrimes, setState, type Crime, type CrimeNear } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

const API = "https://data.police.uk/api";
type CrimeConfig = { centre: { lat: number; lng: number }; radiusKm: number; metres: number; months: number; levels: number[] };
export const LEVELS = ["very low", "low", "average", "high", "very high"] as const;
// Police category ids, as a reader would say them.
const NAMES: Record<string, string> = {
  "violent-crime": "violence",
  "anti-social-behaviour": "antisocial behaviour",
  burglary: "burglary",
  robbery: "robbery",
  drugs: "drugs",
  "criminal-damage-arson": "criminal damage",
  "vehicle-crime": "vehicle crime",
  "theft-from-the-person": "theft from the person",
  "possession-of-weapons": "weapons",
  "public-order": "public order",
  "other-theft": "other theft",
  "bicycle-theft": "bike theft",
  "other-crime": "other",
};

export const crimeConfig = (config: TaskConfig | undefined): CrimeConfig | null => {
  const c = config?.crime as Partial<CrimeConfig> | undefined;
  return c?.centre && c.radiusKm ? { metres: 300, months: 12, levels: [], ...c, centre: c.centre, radiusKm: c.radiusKm } : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export type Box = { s: number; w: number; n: number; e: number };
type PoliceCrime = { id: number; category: string; month: string; location: { latitude: string; longitude: string; street?: { name?: string } } };

// One tile's crimes for a month; a tile over the API's 10,000 (it answers 503) is split in four, twice at
// most. A 429 waits and tries again.
async function tile(month: string, b: Box, depth = 0): Promise<Crime[]> {
  const poly = `${b.s},${b.w}:${b.n},${b.w}:${b.n},${b.e}:${b.s},${b.e}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/crimes-street/all-crime?poly=${poly}&date=${month}`, { signal: AbortSignal.timeout(90_000) });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 503 && depth < 2) {
      const lat = (b.s + b.n) / 2;
      const lng = (b.w + b.e) / 2;
      const quarters = [
        { s: b.s, w: b.w, n: lat, e: lng },
        { s: b.s, w: lng, n: lat, e: b.e },
        { s: lat, w: b.w, n: b.n, e: lng },
        { s: lat, w: lng, n: b.n, e: b.e },
      ];
      return (await Promise.all(quarters.map((q) => tile(month, q, depth + 1)))).flat();
    }
    if (!res.ok) throw new Error(`police API answered ${res.status} for ${month}`);
    return ((await res.json()) as PoliceCrime[]).map((c) => ({
      id: c.id,
      month: c.month,
      category: c.category,
      lat: Number(c.location.latitude),
      lng: Number(c.location.longitude),
      street: c.location.street?.name ?? "",
    }));
  }
  throw new Error(`police API kept answering 429 for ${month}`);
}

// The area fetched: a square around the search's centre reaching `radiusKm` plus `metres`, so a listing
// up to `radiusKm` away has its whole circle inside. Its key in state, so a changed config refetches.
export function areaOf(c: CrimeConfig): Box {
  const dLat = (c.radiusKm + c.metres / 1000) / 110.54;
  const dLng = (c.radiusKm + c.metres / 1000) / (111.32 * Math.cos((c.centre.lat * Math.PI) / 180));
  return { s: c.centre.lat - dLat, w: c.centre.lng - dLng, n: c.centre.lat + dLat, e: c.centre.lng + dLng };
}
const keyOf = (b: Box) => [b.s, b.w, b.n, b.e].map((x) => x.toFixed(5)).join(",");

// The area in tiles of about 4 km a side, so even the centre's stays far under 10,000 a month.
function tiles(a: Box): Box[] {
  const rows = Math.ceil(((a.n - a.s) * 110.54) / 4);
  const cols = Math.ceil(((a.e - a.w) * 111.32 * Math.cos((a.s * Math.PI) / 180)) / 4);
  const out: Box[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const s = a.s + ((a.n - a.s) * r) / rows;
      const w = a.w + ((a.e - a.w) * k) / cols;
      out.push({ s, w, n: s + (a.n - a.s) / rows, e: w + (a.e - a.w) / cols });
    }
  }
  return out;
}

// Fetches the newest `months` months the police have published that are not kept yet for this area, four
// tiles at a time, and drops the older ones. A month is saved only whole; one that fails is tried again
// next run, and does not stop the older ones.
async function fetchMonths(c: CrimeConfig, area: Box): Promise<{ added: string[]; failed: string[] }> {
  const published = ((await (await fetch(`${API}/crimes-street-dates`, { signal: AbortSignal.timeout(30_000) })).json()) as { date: string }[]).map((d) => d.date);
  const want = published.slice(0, c.months);
  const key = keyOf(area);
  const kept = new Set(crimeMonths(key));
  const added: string[] = [];
  const failed: string[] = [];
  for (const month of want.filter((m) => !kept.has(m))) {
    try {
      const boxes = tiles(area);
      const crimes: Crime[] = [];
      for (let i = 0; i < boxes.length; i += 4) crimes.push(...(await Promise.all(boxes.slice(i, i + 4).map((b) => tile(month, b)))).flat());
      saveCrimeMonth(key, month, crimes);
      added.push(month);
    } catch (err) {
      failed.push((err as Error).message);
    }
  }
  dropCrimeMonths(want);
  return { added, failed };
}

const levelOf = (perYear: number, levels: number[]) => LEVELS[levels.length === 4 ? levels.filter((l) => perYear >= l).length : 2];

// The crimes within `metres` of each listing still up, over the kept months, as yearly figures; stored
// when they changed, and marked for a new read only when the level did (a new month moves the counts a
// little every month). A listing whose circle reaches past the area fetched gets none rather than an
// undercount. A grid of cells at least `metres` wide both ways means only the 3 by 3 around a listing are looked at.
export async function crimeHomes(task: string, config: TaskConfig): Promise<string> {
  const c = crimeConfig(config);
  if (!c) return "";
  const area = areaOf(c);
  let fetched: { added: string[]; failed: string[] } = { added: [], failed: [] };
  try {
    fetched = await fetchMonths(c, area);
  } catch (err) {
    fetched.failed.push((err as Error).message);
  }
  const failed = fetched.failed.length ? `; fetching failed, ${fetched.failed.join("; ")}` : "";
  const months = crimeMonths(keyOf(area)).sort();
  if (!months.length) return `no crime data yet${failed}`;
  const cell = c.metres / (111_320 * Math.cos((area.n * Math.PI) / 180));
  const key = (lat: number, lng: number) => `${Math.floor(lat / cell)},${Math.floor(lng / cell)}`;
  const grid = new Map<string, { category: string; lat: number; lng: number }[]>();
  for (const x of loadCrimes()) {
    if (x.category === "shoplifting") continue;
    const k = key(x.lat, x.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(x);
  }
  const span = `${months[0]} to ${months.at(-1)}`;
  const yearly = (n: number) => Math.round((n * 12) / months.length);
  // The crimes within `metres` of a point, or null when its circle reaches past the area fetched.
  const around = (lat: number, lng: number): CrimeNear | null => {
    const mLat = 110_540;
    const mLng = 111_320 * Math.cos((lat * Math.PI) / 180);
    if (lat - c.metres / mLat < area.s || lat + c.metres / mLat > area.n || lng - c.metres / mLng < area.w || lng + c.metres / mLng > area.e) return null;
    const counts: Record<string, number> = {};
    const [row, col] = key(lat, lng).split(",").map(Number);
    for (let r = row - 1; r <= row + 1; r++) {
      for (let k = col - 1; k <= col + 1; k++) {
        for (const x of grid.get(`${r},${k}`) ?? []) {
          if (((x.lat - lat) * mLat) ** 2 + ((x.lng - lng) * mLng) ** 2 <= c.metres ** 2) counts[x.category] = (counts[x.category] ?? 0) + 1;
        }
      }
    }
    const perYear = yearly(Object.values(counts).reduce((a, b) => a + b, 0));
    const by = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, yearly(n)]));
    return { perYear, level: levelOf(perYear, c.levels), by, span, metres: c.metres };
  };
  const changed = new Map<string, { crime: CrimeNear | null; stamp: boolean }>();
  let outside = 0;
  for (const h of homesToScore(task)) {
    const crime = around(h.lat, h.lng);
    if (!crime) outside++;
    if (JSON.stringify(crime) !== JSON.stringify(h.crime)) changed.set(h.id, { crime, stamp: crime?.level !== h.crime?.level });
  }
  saveCrimes(changed);
  // The reader's home now (src/compare.ts), scored the same way, to compare listings with.
  const now = nowConfig(config);
  if (now) setState(nowKey(task), JSON.stringify({ ...JSON.parse(getState(nowKey(task)) ?? "{}"), crime: around(now.lat, now.lng) }));
  const fetchedNote = fetched.added.length ? `fetched ${fetched.added.join(", ")}; ` : "";
  return `${fetchedNote}${changed.size} listings scored${outside ? `, ${outside} outside the area` : ""}${failed}`;
}

// "high: 412 a year within 300 m (violence 150, antisocial behaviour 120, burglary 25)", the three
// biggest kinds.
export function crimeText(c: CrimeNear): string {
  const top = Object.entries(c.by)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${NAMES[k] ?? k} ${n}`);
  return `${c.level}: ${c.perYear} a year within ${c.metres} m${top.length ? ` (${top.join(", ")})` : ""}`;
}
