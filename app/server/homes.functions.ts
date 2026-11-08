import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { getState, listHomes, type HomeRow } from "#src/db.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect and read the listings (tasks/homes).
const TASK = "homes";
const LIMIT = 100;
const BANDS = ["A", "B", "C", "D", "E", "F", "G"];

export type Beds = "0" | "1" | "2" | "3";
export type Epc = "any" | "good" | "unknown" | "poor";
export type Sort = "fit" | "rent" | "new";
export type HomesSearch = { view?: "all"; beds?: Beds; epc?: Epc; area?: string; bills?: true; fit?: true; fresh?: true; reduced?: true; sort?: Sort; more?: true };

// What the reader is after, from task.json's "match": the rent (higher when every bill is included),
// the bedrooms and the worst EPC band.
type Match = { rent: number; rentWithBills: number; minBeds: number; maxBeds: number; epc: string };

export type HomeItem = {
  id: string;
  url: string;
  image: string | null;
  rent: string;
  /** The rent it had before, when it went down. */
  was: string | null;
  title: string;
  address: string;
  area: string | null;
  epc: { band: string; score: number | null; from: string } | null;
  fit: number | null;
  fitWhy: string;
  facts: string[];
  flags: string[];
  agent: string;
  phone: string | null;
  listed: string;
  isNew: boolean;
};

export type HomesPage = {
  nav: Nav;
  search: HomesSearch;
  match: Match;
  /** Listings up now, and those that match. */
  up: number;
  matching: number;
  /** Up and with a page fetched but not read by the model yet: no EPC or fit for them. */
  unread: number;
  /** Up but no page fetched yet. */
  noPage: number;
  shown: number;
  homes: HomeItem[];
  areas: { area: string; count: number }[];
  counts: { beds: Record<Beds, number>; epc: Record<Exclude<Epc, "any">, number> };
  lastRun?: string;
  swept?: string;
};

// Listings are agents' text and photos: behind the admin cookie like the jobs and newsletters.
function gate(next: string) {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next, failed: undefined } });
  setResponseHeader("cache-control", "private, no-store");
}

const pounds = (n: number) => `£${n.toLocaleString("en-GB")}`;
// The postcode district (NG7), from the page's postcode, else the address.
const areaOf = (h: HomeRow) => h.postcode?.split(" ")[0] ?? h.address.match(/\b(NG\d{1,2})\b/i)?.[1]?.toUpperCase() ?? null;
const bedsOf = (h: HomeRow): Beds => (!h.beds ? "0" : h.beds >= 3 ? "3" : (String(h.beds) as Beds));
const epcOf = (h: HomeRow): Exclude<Epc, "any"> => {
  const band = h.read?.epcBand;
  if (!band) return "unknown";
  return band <= "C" ? "good" : "poor";
};
const billsIncluded = (h: HomeRow) => h.read?.bills === "all";
const fresh = (h: HomeRow) => Date.now() - Date.parse(h.listedAt ?? h.firstSeen) < 7 * 86_400_000;
const reducedFrom = (h: HomeRow) => {
  const before = h.prices.at(-2)?.pcm;
  return before && before > h.pricePcm ? before : null;
};

// Within the rent (the higher one when every bill is included), the bedrooms and the EPC band.
function matches(h: HomeRow, m: Match): boolean {
  const rent = billsIncluded(h) ? m.rentWithBills : m.rent;
  const beds = h.beds ?? 0;
  const band = h.read?.epcBand;
  return h.pricePcm <= rent && beds >= m.minBeds && beds <= m.maxBeds && !!band && band <= m.epc;
}

const SAID: Record<string, Record<string, string>> = {
  bills: { all: "Bills included", some: "Some bills included", none: "Bills extra" },
  pets: { yes: "Pets allowed", ask: "Pets considered", no: "No pets" },
  livingRoom: { separate: "Separate lounge", "open plan": "Open-plan lounge", none: "No lounge" },
  garden: { private: "Private garden", shared: "Shared garden" },
  heating: { gas: "Gas heating", electric: "Electric heating", "storage heaters": "Storage heaters", "heat pump": "Heat pump", communal: "Communal heating" },
};

// "2 bed flat"; no bedrooms is a studio, and Rightmove's "Not Specified" type says nothing.
function titleOf(h: HomeRow): string {
  const kind = !h.type || h.type === "Not Specified" ? "home" : h.type.toLowerCase();
  if (h.beds) return `${h.beds} bed ${kind}`;
  return kind === "home" || kind === "studio" ? "Studio" : `Studio ${kind}`;
}

function item(h: HomeRow): HomeItem {
  const d = h.details;
  const r = h.read;
  const said = (key: keyof typeof SAID, value?: string) => (value && SAID[key][value] ? [SAID[key][value]] : []);
  const was = reducedFrom(h);
  const sqm = d?.sqm ?? r?.sqm ?? null;
  return {
    id: h.id,
    url: h.url,
    image: h.image,
    rent: `${pounds(h.pricePcm)} pcm`,
    was: was ? pounds(was) : null,
    title: titleOf(h),
    address: h.address,
    area: areaOf(h),
    epc: r?.epcBand ? { band: r.epcBand, score: r.epcScore, from: r.epcFrom } : null,
    fit: r?.fit ?? null,
    fitWhy: r?.fitWhy ?? "",
    facts: [
      ...(r?.bills === "some" && r.billsWhat ? [`Includes ${r.billsWhat}`] : said("bills", r?.bills)),
      ...(d?.furnish ? [d.furnish] : []),
      ...(d?.availableFrom ? [`Available ${d.availableFrom === "Now" ? "now" : d.availableFrom}`] : []),
      ...(d?.deposit ? [`Deposit ${pounds(d.deposit)}`] : []),
      ...(sqm ? [`${sqm} m²`] : []),
      ...said("livingRoom", r?.livingRoom),
      ...said("heating", r?.heating),
      ...said("garden", r?.garden),
      ...said("pets", r?.pets),
      ...(d?.councilTaxBand ? [`Council tax ${d.councilTaxBand}`] : []),
    ],
    flags: r?.redFlags ?? [],
    agent: h.agent,
    phone: d?.phone ?? h.phone,
    listed: formatDay(h.listedAt ?? h.firstSeen, "Europe/London"),
    isNew: fresh(h),
  };
}

// The listings up now, the matches by default (?view=all for every one), filtered by the chips and
// sorted by fit (unread last), rent or newest. The chips' counts are over the view, before the chips.
export const getHomesPage = createServerFn({ method: "GET" })
  .validator((data: HomesSearch) => data)
  .handler(async ({ data }): Promise<HomesPage> => {
    gate("/homes");
    const { configs, ...sidebar } = await nav();
    const m: Match = { rent: 850, rentWithBills: 1000, minBeds: 1, maxBeds: 3, epc: "C", ...((configs.get(TASK)?.match ?? {}) as Partial<Match>) };
    if (!BANDS.includes(m.epc)) m.epc = "C";
    const all = listHomes(TASK);
    const up = all.filter((h) => h.up);
    const inView = data.view === "all" ? up : up.filter((h) => matches(h, m));
    const area = data.area?.toUpperCase();
    const chosen = inView.filter(
      (h) =>
        (!data.beds || bedsOf(h) === data.beds) &&
        (!data.epc || data.epc === "any" || epcOf(h) === data.epc) &&
        (!area || areaOf(h) === area) &&
        (!data.bills || billsIncluded(h)) &&
        (!data.fit || (h.read?.fit ?? 0) >= 4) &&
        (!data.fresh || fresh(h)) &&
        (!data.reduced || reducedFrom(h) !== null),
    );
    const sort = data.sort ?? "fit";
    const newest = (a: HomeRow, b: HomeRow) => (b.listedAt ?? b.firstSeen).localeCompare(a.listedAt ?? a.firstSeen);
    chosen.sort((a, b) =>
      sort === "rent" ? a.pricePcm - b.pricePcm : sort === "new" ? newest(a, b) : (b.read?.fit ?? 0) - (a.read?.fit ?? 0) || a.pricePcm - b.pricePcm || newest(a, b),
    );
    const count = <K extends string>(keys: K[], of: (h: HomeRow) => K) => Object.fromEntries(keys.map((k) => [k, inView.filter((h) => of(h) === k).length])) as Record<K, number>;
    const byArea = new Map<string, number>();
    for (const h of inView) {
      const a = areaOf(h);
      if (a) byArea.set(a, (byArea.get(a) ?? 0) + 1);
    }
    // The last collection is the newest sighting: a run whose read fails has still collected.
    const lastSeen = all.reduce<string | undefined>((max, h) => (!max || h.lastSeen > max ? h.lastSeen : max), undefined);
    const swept = getState(`swept:${TASK}`);
    return {
      nav: sidebar,
      search: data,
      match: m,
      up: up.length,
      matching: up.filter((h) => matches(h, m)).length,
      unread: up.filter((h) => h.details && !h.read).length,
      noPage: up.filter((h) => !h.details).length,
      shown: chosen.length,
      homes: (data.more ? chosen : chosen.slice(0, LIMIT)).map(item),
      areas: [...byArea].map(([a, n]) => ({ area: a, count: n })).sort((a, b) => Number(a.area.slice(2)) - Number(b.area.slice(2))),
      counts: { beds: count(["0", "1", "2", "3"], bedsOf), epc: count(["good", "unknown", "poor"], epcOf) },
      lastRun: lastSeen && ago(lastSeen),
      swept: swept ? ago(swept) : undefined,
    };
  });
