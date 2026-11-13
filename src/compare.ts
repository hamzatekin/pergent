// How a homes listing compares: its deposit against the legal cap, its rent against listings like it,
// how long it has been up, the same home listed by another agent, and the reader's home now. All code,
// from what is already collected; the page, the Telegram message and the model's text share them.
import type { Place } from "./commute.ts";
import { LEVELS } from "./crime.ts";
import { getState, type Commute, type CrimeNear, type HomeDetails, type HomeRow } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const DAY = 86_400_000;

// The Tenant Fees Act 2019 caps a tenancy deposit at 5 weeks' rent, 6 when the rent is £50,000 a year
// or more. A deposit over it (by more than a pound, for rounding) is a red flag.
export function depositOver(h: { pricePcm: number; details: HomeDetails | null }): string | null {
  const deposit = h.details?.deposit;
  if (!deposit) return null;
  const weeks = h.pricePcm * 12 >= 50_000 ? 6 : 5;
  const cap = ((h.pricePcm * 12) / 52) * weeks;
  return deposit > cap + 1 ? `Deposit ${pounds(deposit)} is over the legal cap of ${weeks} weeks' rent, ${pounds(Math.floor(cap))}` : null;
}

type Placed = { pricePcm: number; beds: number | null; postcode: string | null; address: string };

export const districtOf = (h: { postcode: string | null; address: string }) => h.postcode?.split(" ")[0] ?? h.address.match(/\b(NG\d{1,2})\b/i)?.[1]?.toUpperCase() ?? null;
const bedKey = (beds: number | null) => Math.min(beds ?? 0, 3);
const bedName = (k: number) => (k === 0 ? "studio" : k === 3 ? "3+ bed" : `${k}-bed`);

export type Medians = Map<string, { median: number; n: number; capped: boolean }>;

// The search's highest rent (task.json's collect.search.maxPrice): nothing dearer is collected.
export const ceilingOf = (config: TaskConfig | undefined) => ((config?.collect as { search?: { maxPrice?: number } } | undefined)?.search?.maxPrice ?? null);

// The median rent of the listings up now by postcode district and bedrooms (studio, 1, 2, 3+). A group
// with over a quarter of its listings within £50 of the search's `ceiling` is `capped`: the dearer ones
// were never collected, so its median says little (3+ beds in NG11 sat at £1,100, the ceiling).
export function rentMedians(homes: Placed[], ceiling: number | null): Medians {
  const rents = new Map<string, number[]>();
  for (const h of homes) {
    const d = districtOf(h);
    if (!d) continue;
    const key = `${d} ${bedKey(h.beds)}`;
    rents.set(key, [...(rents.get(key) ?? []), h.pricePcm]);
  }
  const out: Medians = new Map();
  for (const [key, list] of rents) {
    const s = list.sort((a, b) => a - b);
    const mid = s.length / 2;
    const near = ceiling === null ? 0 : s.filter((r) => r >= ceiling - 50).length;
    out.set(key, { median: s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2, n: s.length, capped: near > s.length / 4 });
  }
  return out;
}

// "£60 under the NG7 2-bed median of £910 (23 listings)", when at least 5 listings compare.
export function vsArea(h: Placed, medians: Medians): string | null {
  const d = districtOf(h);
  const m = d ? medians.get(`${d} ${bedKey(h.beds)}`) : undefined;
  if (!d || !m || m.n < 5 || m.capped) return null;
  const diff = h.pricePcm - m.median;
  const what = `the ${d} ${bedName(bedKey(h.beds))} median of ${pounds(m.median)} (${m.n} listings)`;
  return Math.abs(diff) < 10 ? `At ${what}` : `${pounds(Math.abs(diff))} ${diff < 0 ? "under" : "over"} ${what}`;
}

// "Up 40 days, down £100 from £950": since Rightmove first showed it, and how far its rent is below the
// first one collected.
export function onMarket(h: { listedAt: string | null; firstSeen: string; prices: { at: string; pcm: number }[] }, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(h.listedAt ?? h.firstSeen)) / DAY));
  const up = days === 0 ? "Up today" : `Up ${days} day${days === 1 ? "" : "s"}`;
  const first = h.prices[0]?.pcm;
  const last = h.prices.at(-1)?.pcm;
  return first && last && last < first ? `${up}, down ${pounds(first - last)} from ${pounds(first)}` : up;
}

// The same home listed by more than one agent, among listings up with the same full postcode, bedrooms and
// type, from different agents, rents within 5% of each other. `sure` when both addresses give the same
// house or flat number, or both were matched by address to the same certificate; only a maybe when they
// share an EPC score, a floor area or a certificate matched by score, since flats alike in one block
// share those (12.6% of the pairs of flats at one postcode on the register had the same score). Anything
// that disagrees (numbers, scores, areas, certificates matched by address) rules it out. OpenRent's own
// copy on Rightmove names the OpenRent listing ("Property Reference: 3065896"), so those two are sure
// whatever else they say. Returns each listing's copies.
export type Copy = { home: HomeRow; sure: boolean };

// The OpenRent listing a Rightmove listing by OpenRent is a copy of, as its id in the homes table.
function openrentCopyOf(h: HomeRow): string | null {
  if (h.id.startsWith("openrent:") || !/openrent/i.test(h.agent) || !h.details) return null;
  const ref = `${h.details.keyFeatures.join("\n")}\n${h.details.description}`.match(/Property Reference(?: Number)?:\s*(\d+)/i)?.[1];
  return ref ? `openrent:${ref}` : null;
}

export function duplicates(homes: HomeRow[]): Map<string, Copy[]> {
  const groups = new Map<string, HomeRow[]>();
  for (const h of homes) {
    if (!h.postcode || !/\s\d[A-Z]{2}$/i.test(h.postcode)) continue;
    const key = `${h.postcode.toUpperCase()}|${bedKey(h.beds)}|${h.type.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const number = (h: HomeRow) => h.address.split(",")[0].match(/\d+[a-z]?/i)?.[0]?.toLowerCase() ?? null;
  const sqm = (h: HomeRow) => h.details?.sqm ?? (h.read?.sqm || null);
  const byAddress = (h: HomeRow) => (h.cert?.how === "address" ? (h.cert.cert?.number ?? null) : null);
  const same = (a: HomeRow, b: HomeRow): boolean | null => {
    if (a.agent.trim().toLowerCase() === b.agent.trim().toLowerCase()) return null;
    if (Math.abs(a.pricePcm - b.pricePcm) > 0.05 * Math.min(a.pricePcm, b.pricePcm)) return null;
    const checks: [unknown, unknown, (x: number | string, y: number | string) => boolean][] = [
      [number(a), number(b), (x, y) => x === y],
      [byAddress(a), byAddress(b), (x, y) => x === y],
      [a.read?.epcScore || null, b.read?.epcScore || null, (x, y) => x === y],
      [sqm(a), sqm(b), (x, y) => Math.abs(Number(x) - Number(y)) <= 1],
      [a.cert?.cert?.number ?? null, b.cert?.cert?.number ?? null, (x, y) => x === y],
    ];
    const known = checks.filter(([x, y]) => x && y) as [number | string, number | string, (x: number | string, y: number | string) => boolean][];
    if (!known.length || !known.every(([x, y, eq]) => eq(x, y))) return null;
    return (!!number(a) && !!number(b)) || (!!byAddress(a) && !!byAddress(b));
  };
  const out = new Map<string, Copy[]>();
  for (const list of groups.values()) {
    for (const a of list) {
      const copies = list.flatMap((b) => {
        const sure = b === a ? null : same(a, b);
        return sure === null ? [] : [{ home: b, sure }];
      });
      if (copies.length) out.set(a.id, copies);
    }
  }
  const byId = new Map(homes.map((h) => [h.id, h]));
  for (const h of homes) {
    const twin = byId.get(openrentCopyOf(h) ?? "");
    if (!twin) continue;
    for (const [a, b] of [[h, twin], [twin, h]]) out.set(a.id, [...(out.get(a.id) ?? []).filter((c) => c.home.id !== b.id), { home: b, sure: true }]);
  }
  return out;
}

// Which due listings to message when some are one home: `send` the first copy in `due`'s order; `held`
// the others, each under the copy sent for it (or under "" when a copy already went out at its rent or
// less), to be marked as messaged with it so a held copy never comes up on its own later.
export function dedupe(due: HomeRow[], dupes: Map<string, Copy[]>): { send: HomeRow[]; held: Map<string, HomeRow[]> } {
  const send: HomeRow[] = [];
  const held = new Map<string, HomeRow[]>();
  const hold = (key: string, h: HomeRow) => held.set(key, [...(held.get(key) ?? []), h]);
  for (const h of due) {
    const twins = (dupes.get(h.id) ?? []).filter((c) => c.sure).map((c) => c.home);
    const sent = send.find((k) => twins.some((t) => t.id === k.id));
    if (twins.some((t) => t.notifiedPcm !== null && t.notifiedPcm <= h.pricePcm)) hold("", h);
    else if (sent) hold(sent.id, h);
    else send.push(h);
  }
  return { send, held };
}

// The reader's home now (task.json's "now": a label, where it is and its EPC), with its minutes to the
// commute places and its crime, worked out like a listing's and kept in state (src/commute.ts, src/crime.ts).
export type NowConfig = { label: string; lat: number; lng: number; epc?: { band: string; score: number | null } };
export type Now = NowConfig & { commute: Commute; crime: CrimeNear | null };

export const nowConfig = (config: TaskConfig | undefined): NowConfig | null => {
  const n = config?.now as Partial<NowConfig> | undefined;
  return n?.label && typeof n.lat === "number" && typeof n.lng === "number" ? (n as NowConfig) : null;
};

export const nowKey = (task: string) => `now:${task}`;

export function nowOf(task: string, config: TaskConfig | undefined): Now | null {
  const n = nowConfig(config);
  if (!n) return null;
  const kept = JSON.parse(getState(nowKey(task)) ?? "{}") as Partial<Now>;
  return { ...n, commute: kept.commute ?? {}, crime: kept.crime ?? null };
}

// "Better than now on the EPC (C 72 vs D 66) and crime (low vs average); worse on Work (45 vs 38 min)":
// the EPC by score (else band), each commute place with a limit by minutes (2 or fewer either way is the
// same), and the crime level. Null when nothing compares.
export function vsNow(h: { read?: { epcBand: string | null; epcScore: number | null } | null; commute: Commute; crime: CrimeNear | null }, now: Now, places: Place[]): string | null {
  const better: string[] = [];
  const worse: string[] = [];
  const band = h.read?.epcBand;
  if (band && now.epc) {
    const mine = h.read?.epcScore ?? null;
    const theirs = now.epc.score;
    const cmp = mine !== null && theirs !== null ? mine - theirs : now.epc.band.localeCompare(band);
    const text = `the EPC (${band}${mine ? ` ${mine}` : ""} vs ${now.epc.band}${theirs ? ` ${theirs}` : ""})`;
    if (cmp > 0) better.push(text);
    else if (cmp < 0) worse.push(text);
  }
  for (const p of places.filter((p) => p.max !== undefined)) {
    const mine = h.commute[p.name];
    const theirs = now.commute[p.name];
    if (!mine || !theirs || mine.min === null || theirs.min === null || Math.abs(mine.min - theirs.min) <= 2) continue;
    (mine.min < theirs.min ? better : worse).push(`${p.name} (${mine.min} vs ${theirs.min} min)`);
  }
  if (h.crime && now.crime && h.crime.level !== now.crime.level) {
    const rank = (level: string) => LEVELS.indexOf(level as (typeof LEVELS)[number]);
    (rank(h.crime.level) < rank(now.crime.level) ? better : worse).push(`crime (${h.crime.level} vs ${now.crime.level})`);
  }
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  const parts = [better.length ? `better than now on ${and(better)}` : "", worse.length ? `worse${better.length ? "" : " than now"} on ${and(worse)}` : ""].filter(Boolean);
  if (!parts.length) return null;
  const text = parts.join("; ");
  return text[0].toUpperCase() + text.slice(1);
}
