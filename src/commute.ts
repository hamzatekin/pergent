// How long it takes from each homes listing to the places the reader goes (task.json's "commute"), by
// bus, tram and walking, door to door: TravelTime's time-filter API (docs.traveltime.com), one request a
// place for up to 2,000 listings, so a run costs a request a place and only when new listings came. A
// time is for the next ordinary `arrive` ("Mon 08:45", London time; never a bank holiday or Christmas
// week, whose timetables are thin) and is kept on the listing: timetables change little. Without
// TRAVELTIME_APP_ID and TRAVELTIME_API_KEY nothing is timed.
import { nowConfig, nowKey } from "./compare.ts";
import { getState, homesToTime, saveCommutes, setState, type Commute } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

/**
 * A place the reader goes, and the most minutes a match may take to get there (none: shown, not a limit).
 * `window`: minutes before `arrive` in which any arrival will do, for a place with no fixed start time
 * (the quickest trip in it counts); without one, the trip must arrive by `arrive`, and a wait there counts.
 */
export type Place = { name: string; where?: string; lat: number; lng: number; arrive: string; window?: number; max?: number };

// Longer than this is "over 90 min" (null).
const LIMIT = 90 * 60;
// Departure points a search takes at most.
const BATCH = 2000;

export const placesOf = (config: TaskConfig | undefined): Place[] => ((config?.commute ?? {}) as { places?: Place[] }).places ?? [];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The next `arrive` ("Mon 08:45") at least a day ahead that is not one of `holidays` (YYYY-MM-DD) or
// between Christmas Eve and New Year's Day, in London time with its offset, as TravelTime wants it; a
// timetable is only known for the weeks ahead. Steps by calendar date, so a clock change cannot skip one.
export function nextArrival(arrive: string, holidays: Set<string>, now = new Date()): string {
  const [day, time] = arrive.split(" ");
  const want = DAYS.indexOf(day);
  if (want < 0 || !/^\d\d:\d\d$/.test(time ?? "")) throw new Error(`commute: cannot read arrive "${arrive}", expected like "Mon 08:45"`);
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now).split("-").map(Number);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "longOffset" });
  for (let i = 1; i <= 28; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const iso = date.toISOString().slice(0, 10);
    const monthDay = iso.slice(5);
    if (date.getUTCDay() !== want || holidays.has(iso) || monthDay >= "12-24" || monthDay <= "01-01") continue;
    const name = zone.formatToParts(new Date(`${iso}T12:00:00Z`)).find((p) => p.type === "timeZoneName")!.value;
    return `${iso}T${time}:00${name === "GMT" ? "+00:00" : name.slice(3)}`;
  }
  throw new Error(`commute: no ordinary ${day} in the next four weeks`);
}

// England and Wales's bank holidays from GOV.UK; none when it does not answer (Christmas week is skipped
// whatever).
async function bankHolidays(): Promise<Set<string>> {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json", { signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as Record<string, { events: { date: string }[] }>;
    return new Set(json["england-and-wales"].events.map((e) => e.date));
  } catch {
    return new Set();
  }
}

type Leg = { mode: string; type: string; line?: string };
// The rides of a route, "bus 68 + tram"; "walk" when walking is quickest. TravelTime calls the tram a
// bus on line "TRAM (of NET)" and names a train by its whole route.
function via(legs: Leg[]): string {
  const rides = legs
    .filter((l) => l.type === "public_transport")
    .map((l) => {
      const line = (l.line ?? "").replace(/\s*\(of .*$/, "").trim();
      if (/^tram$/i.test(line)) return "tram";
      if (/^(rail|train)/.test(l.mode)) return "train";
      return line ? `${l.mode} ${line}` : l.mode;
    });
  // A change between two trams is still "tram".
  const changes = rides.filter((r, i) => r !== rides[i - 1]);
  return changes.length ? changes.join(" + ") : "walk";
}

type Found = Map<string, { min: number | null; via?: string }>;

async function search(place: Place, homes: { id: string; lat: number; lng: number }[], route: boolean, holidays: Set<string>): Promise<Found> {
  const res = await fetch("https://api.traveltimeapp.com/v4/time-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Application-Id": process.env.TRAVELTIME_APP_ID!, "X-Api-Key": process.env.TRAVELTIME_API_KEY! },
    body: JSON.stringify({
      locations: [{ id: "@place", coords: { lat: place.lat, lng: place.lng } }, ...homes.map((h) => ({ id: h.id, coords: { lat: h.lat, lng: h.lng } }))],
      arrival_searches: [
        {
          id: place.name,
          departure_location_ids: homes.map((h) => h.id),
          arrival_location_id: "@place",
          transportation: { type: "public_transport" },
          arrival_time: nextArrival(place.arrive, holidays),
          travel_time: LIMIT,
          properties: route ? ["travel_time", "route"] : ["travel_time"],
          ...(place.window ? { range: { enabled: true, width: place.window * 60, max_results: 1 } } : {}),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`TravelTime answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { results: { locations: { id: string; properties: { travel_time: number; route?: { parts: Leg[] } }[] }[]; unreachable: string[] }[] };
  const found: Found = new Map();
  for (const r of json.results) {
    for (const l of r.locations) {
      const p = l.properties[0];
      found.set(l.id, { min: Math.round(p.travel_time / 60), ...(p.route ? { via: via(p.route.parts) } : {}) });
    }
    for (const id of r.unreachable) found.set(id, { min: null });
  }
  return found;
}

// Times the listings still up that lack a time to one of the places, and stores those that got one. The
// route (which bus or tram) only for the places with a limit. A failed search leaves those listings for
// the next run. Returns a line for the run's note.
export async function timeHomes(task: string, config: TaskConfig): Promise<string> {
  const places = placesOf(config);
  if (!places.length) return "";
  if (!process.env.TRAVELTIME_APP_ID || !process.env.TRAVELTIME_API_KEY) return "commute off (no TravelTime key)";
  const homes = homesToTime(task, places.map((p) => p.name));
  const now = nowConfig(config);
  // Timed again from scratch when the home now moves (its lat and lng are kept with the times).
  const kept = JSON.parse(getState(nowKey(task)) ?? "{}") as { commute?: Commute; commuteFrom?: string };
  const from = now ? `${now.lat},${now.lng}` : "";
  if (kept.commuteFrom !== from) kept.commute = {};
  const nowMissing = now ? places.filter((p) => !kept.commute?.[p.name]) : [];
  if (!homes.length && !nowMissing.length) return "";
  const holidays = await bankHolidays();
  // The reader's home now (src/compare.ts), timed the same way once, to compare listings with.
  if (now && nowMissing.length) {
    const commute = { ...kept.commute };
    for (const place of nowMissing) {
      const time = (await search(place, [{ id: "now", lat: now.lat, lng: now.lng }], place.max !== undefined, holidays).catch(() => null))?.get("now");
      if (time) commute[place.name] = time;
    }
    setState(nowKey(task), JSON.stringify({ ...JSON.parse(getState(nowKey(task)) ?? "{}"), commute, commuteFrom: from }));
  }
  if (!homes.length) return "";
  const before = new Map(homes.map((h) => [h.id, h.commute]));
  const timed = new Map<string, Commute>();
  const failed: string[] = [];
  for (const place of places) {
    const missing = homes.filter((h) => !(place.name in h.commute));
    try {
      for (let i = 0; i < missing.length; i += BATCH) {
        for (const [id, time] of await search(place, missing.slice(i, i + BATCH), place.max !== undefined, holidays)) {
          timed.set(id, { ...(timed.get(id) ?? before.get(id)), [place.name]: time });
        }
      }
    } catch (err) {
      failed.push(`${place.name}: ${(err as Error).message}`);
    }
  }
  // Only the listings that got a time: a new time means the listing is read again (unreadHomes).
  saveCommutes(timed);
  return `${timed.size} listings timed${failed.length ? `; failed ${failed.join("; ")}` : ""}`;
}
