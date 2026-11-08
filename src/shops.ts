// The supermarkets near each homes listing, from OpenStreetMap through the Overpass API (free, no key):
// every supermarket and convenience shop in the crime area (src/crime.ts's `areaOf`), fetched again
// every `shops.days` (30) or when the area changes, and kept in state `shops:<task>`. A listing's nearest
// shop of task.json's `shops.brands` (matched in the brand or the name, so Tesco Express is Tesco) is
// worked out when asked, as the crow flies. A failed fetch (an error, an answer with a remark, no shops,
// or under half the shops kept) keeps the old list.
import { areaOf, crimeConfig } from "./crime.ts";
import { getState, setState } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const DAY = 86_400_000;

export type Shop = { name: string; brand: string; lat: number; lng: number };
export type ShopsConfig = { brands: string[]; metres: number; days: number };
type Kept = { at: string; area: string; shops: Shop[] };

export const shopsConfig = (config: TaskConfig | undefined): ShopsConfig | null => {
  const s = config?.shops as Partial<ShopsConfig> | undefined;
  return s?.brands?.length ? { metres: 800, days: 30, ...s, brands: s.brands } : null;
};

const key = (task: string) => `shops:${task}`;

// Fetches the shops when the kept list is older than `days` or for another area. Returns a line for the
// run's notes, "" when nothing was fetched.
export async function fetchShops(task: string, config: TaskConfig): Promise<string> {
  const s = shopsConfig(config);
  const c = crimeConfig(config);
  if (!s || !c) return "";
  const box = areaOf(c);
  const area = [box.s, box.w, box.n, box.e].map((x) => x.toFixed(4)).join(",");
  const kept = JSON.parse(getState(key(task)) ?? "null") as Kept | null;
  if (kept && kept.area === area && Date.now() - Date.parse(kept.at) < s.days * DAY) return "";
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "pergent-homes/1.0 (personal rental search)" },
    body: new URLSearchParams({ data: `[out:json][timeout:90];nwr["shop"~"^(supermarket|convenience)$"](${area});out center tags;` }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  type Element = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
  const { elements, remark } = (await res.json()) as { elements?: Element[]; remark?: string };
  // Overpass answers a query that ran out of time or memory with 200, a remark and what it had so far.
  if (remark || !elements?.length) throw new Error(`Overpass: ${remark ?? "no shops"}`);
  const shops = elements.flatMap((e): Shop[] => {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const name = e.tags?.name ?? e.tags?.brand;
    return lat && lng && name ? [{ name, brand: e.tags?.brand ?? "", lat, lng }] : [];
  });
  if (kept && kept.area === area && shops.length < kept.shops.length / 2) throw new Error(`Overpass gave ${shops.length} shops against ${kept.shops.length} kept`);
  setState(key(task), JSON.stringify({ at: new Date().toISOString(), area, shops } satisfies Kept));
  return `${shops.length} shops fetched`;
}

// The kept shops of the configured brands, and how near counts; null without a config or a list.
export function shopsOf(task: string, config: TaskConfig | undefined): { shops: Shop[]; metres: number } | null {
  const s = shopsConfig(config);
  const kept = s && (JSON.parse(getState(key(task)) ?? "null") as Kept | null);
  if (!s || !kept) return null;
  const brands = s.brands.map((b) => b.toLowerCase());
  return { shops: kept.shops.filter((p) => brands.some((b) => `${p.brand} ${p.name}`.toLowerCase().includes(b))), metres: s.metres };
}

// The nearest of `shops` to a point, as the crow flies, with its distance rounded to 50 m.
export function nearestShop(lat: number | null, lng: number | null, shops: Shop[]): { name: string; metres: number } | null {
  if (lat === null || lng === null) return null;
  let best: { name: string; metres: number } | null = null;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const p of shops) {
    const metres = Math.hypot((p.lat - lat) * 111_320, (p.lng - lng) * 111_320 * cos);
    if (!best || metres < best.metres) best = { name: p.name, metres };
  }
  return best && { name: best.name, metres: Math.max(50, Math.round(best.metres / 50) * 50) };
}

export const shopText = (s: { name: string; metres: number }) => `${s.name} ${s.metres >= 1000 ? `${(s.metres / 1000).toFixed(1)} km` : `${s.metres} m`}`;
