import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { placesOf, type Place } from "#src/commute.ts";
import { ceilingOf, depositOver, districtOf, duplicates, nowOf, onMarket, rentMedians, vsArea, vsNow, type Copy, type Medians, type Now } from "#src/compare.ts";
import { crimeText } from "#src/crime.ts";
import { allIn, certText, costsOf, type Costs } from "#src/epc.ts";
import { getState, listHomes, type HomeRow } from "#src/db.ts";
import { commuteTimes, hiddenOf, matches, matchOf, titleOf, type Match } from "#src/homes.ts";
import { redFlagsOf, scoreConfig, scoreLabel, scoreOf, scoreParts, type Score, type ScoreConfig } from "#src/score.ts";
import { nearestShop, shopsOf, shopText, type Shop } from "#src/shops.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { ago, formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

// The task whose runs collect and read the listings (tasks/homes).
const TASK = "homes";
const LIMIT = 100;

export type Beds = "0" | "1" | "2" | "3";
export type Epc = "any" | "good" | "unknown" | "poor";
export type Sort = "fit" | "rent" | "allin" | "near" | "new";
export type HomesSearch = { view?: "all" | "hidden"; beds?: Beds; epc?: Epc; area?: string; bills?: true; fit?: true; fresh?: true; reduced?: true; safer?: true; sort?: Sort; more?: true };

export type HomeItem = {
  id: string;
  url: string;
  image: string | null;
  rent: string;
  /** The rent it had before, when it went down. */
  was: string | null;
  title: string;
  /** "1 bath", "54 m²", after the title. */
  size: string[];
  address: string;
  area: string | null;
  epc: { band: string; score: number | null; from: string } | null;
  /** Its score out of 10 (src/score.ts): "6.5/10", each part with its points, and whether it is a good score. */
  score: { label: string; parts: string; good: boolean } | null;
  fitWhy: string;
  /** What the row says at a glance, after the address: the first commute place with a limit (work) and its
   * route, the heating, the crime level and the furnishing; `bad` when over the limit or high crime. */
  key: { text: string; bad: boolean }[];
  /** "Centre 19 min (tram)" for each other commute place, and whether it is over the place's limit. */
  commute: { name: string; text: string; over: boolean }[];
  /** "high: 412 a year within 300 m (violence 150, …)", and whether it is high or very high. */
  crime: { text: string; high: boolean } | null;
  /** "All in about £1,098 a month" and "energy £145, council tax band B £109, water £49", with the sums
   * and the certificate behind it as its tooltip. */
  allIn: { head: string; parts: string; title: string } | null;
  /** "£60 under the NG7 2-bed median of £910 (23 listings)". */
  vsArea: string | null;
  /** "Better than now on the EPC (C 72 vs D 66); worse on Work (45 vs 38 min)". */
  vsNow: string | null;
  /** "Up 40 days, cut twice from £950". */
  market: string;
  /** The same home listed by other agents (src/compare.ts duplicates): `sure` ones are folded into this
   * row, maybe ones keep their own row and are named here too. */
  also: { agent: string; rent: string; url: string; sure: boolean }[];
  facts: string[];
  flags: string[];
  agent: string;
  phone: string | null;
  listed: string;
  isNew: boolean;
};

export type HomesPage = {
  nav: Nav;
  /** The reader's home now, as the listings are compared with it: "your house share: EPC D 66, Work 38 min, Centre 16 min, crime average". */
  now: string | null;
  /** Listings folded into another's row as the same home from another agent. */
  folded: number;
  search: HomesSearch;
  match: Match;
  /** The commute limits, "40 minutes to Work". */
  limits: string[];
  /** Listings up now, and those that match, leaving out the hidden ones. */
  up: number;
  matching: number;
  /** Listings up now that the reader hid (Not interested), with the sure copies of one. */
  hidden: number;
  /** A good score (task.json's score.good), for the chip. */
  good: number;
  /** Up and with a page fetched but not read by the model yet: no EPC or score for them. */
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
const areaOf = (h: HomeRow) => districtOf(h);
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

const SAID: Record<string, Record<string, string>> = {
  bills: { all: "Bills included", some: "Some bills included", none: "Bills extra" },
  pets: { yes: "Pets allowed", ask: "Pets considered", no: "No pets" },
  livingRoom: { separate: "Separate lounge", "open plan": "Open-plan lounge", none: "No lounge" },
  garden: { private: "Private garden", shared: "Shared garden" },
  heating: { gas: "Gas heating", electric: "Electric heating", "storage heaters": "Storage heaters", "heat pump": "Heat pump", communal: "Communal heating" },
};

// The month's cost (src/epc.ts) as the page says it: what it comes to, then each part, naming what is
// in the rent and what could not be priced.
function allInLine(h: HomeRow, costs: Costs): HomeItem["allIn"] {
  const a = allIn(h, costs);
  const parts = [
    a.billsIn ? "bills in the rent" : a.energy ? `energy ${pounds(a.energy)}` : "",
    a.taxIn ? "council tax in the rent" : a.councilTax ? `council tax ${h.details?.councilTaxBand?.toUpperCase()} ${pounds(a.councilTax)}` : "",
    a.water ? `water ${pounds(a.water)}` : "",
    // Why council tax could not be priced: the band, or the council, is not known.
    a.missing.includes("council tax") ? (h.details?.councilTaxBand ? `council tax band ${h.details.councilTaxBand.toUpperCase()}, council not known` : "council tax band not given") : "",
  ].filter(Boolean);
  const head = a.missing.length ? `About ${pounds(a.total)} a month before ${a.missing.join(" and ")}` : `All in about ${pounds(a.total)} a month`;
  const how = [
    h.cert?.cert ? `EPC register: ${certText(h.cert)}` : "No EPC certificate matched, so no energy figure",
    `Energy: the certificate's heating and hot water at ${costs.prices} prices, plus ${costs.appliancesKwh.toLocaleString("en-GB")} kWh of electricity`,
    `Council tax: ${h.cert?.council ?? "council unknown"}, band ${h.details?.councilTaxBand ?? "not given"}${costs.singlePerson ? ", 25% off for one person" : ""}`,
  ];
  return { head, parts: parts.join(", "), title: how.join("\n") };
}

// "your house share: EPC D 66, Work 38 min, Centre 16 min, crime average", for "Compared with …".
function nowLine(now: Now, places: Place[]): string {
  const parts = [
    now.epc ? `EPC ${now.epc.band}${now.epc.score ? ` ${now.epc.score}` : ""}` : "",
    ...places.filter((p) => p.max !== undefined && now.commute[p.name]?.min != null).map((p) => `${p.name} ${now.commute[p.name].min} min`),
    now.crime ? `crime ${now.crime.level}` : "",
  ].filter(Boolean);
  return `${now.label}: ${parts.join(", ")}`;
}

// What a row compares its listing with (src/compare.ts).
type Context = { places: Place[]; costs: Costs | null; medians: Medians; now: Now | null; dupes: Map<string, Copy[]>; scores: ScoreConfig; near: { shops: Shop[]; metres: number } | null };

function item(h: HomeRow, x: Context, also: HomeRow[], sc: Score | null): HomeItem {
  const { places, costs } = x;
  const d = h.details;
  const r = h.read;
  const said = (key: keyof typeof SAID, value?: string) => (value && SAID[key][value] ? [SAID[key][value]] : []);
  const was = reducedFrom(h);
  const sqm = d?.sqm ?? r?.sqm ?? null;
  const shop = x.near ? nearestShop(h.lat, h.lng, x.near.shops) : null;
  const times = commuteTimes(h.commute, places);
  const work = times.find((c) => c.name === places.find((p) => p.max !== undefined)?.name);
  const heating = r?.heating ? (SAID.heating[r.heating] ?? (r.heating === "not said" ? "Heating not said" : `${r.heating} heating`)) : null;
  return {
    id: h.id,
    url: h.url,
    image: h.image,
    rent: `${pounds(h.pricePcm)} pcm`,
    was: was ? pounds(was) : null,
    title: titleOf(h),
    size: [...(h.baths ? [`${h.baths} bath${h.baths > 1 ? "s" : ""}`] : []), ...(sqm ? [`${sqm} m²`] : [])],
    // Every listing is in or around Nottingham: the city and county say nothing.
    address: h.address.split(",").map((p) => p.trim()).filter((p) => !/^nottingham(shire)?$/i.test(p)).join(", ") || h.address,
    area: areaOf(h),
    epc: r?.epcBand ? { band: r.epcBand, score: r.epcScore, from: r.epcFrom } : null,
    score: sc ? { label: scoreLabel(sc), parts: scoreParts(sc), good: sc.score >= x.scores.good } : null,
    fitWhy: r?.fitWhy ?? "",
    key: [
      ...(work ? [{ text: work.text, bad: work.over }] : []),
      ...(heating ? [{ text: heating, bad: false }] : []),
      ...(h.crime ? [{ text: `Crime ${h.crime.level}`, bad: h.crime.level === "high" || h.crime.level === "very high" }] : []),
      ...(d?.furnish ? [{ text: d.furnish, bad: false }] : []),
    ],
    commute: times.filter((c) => c !== work),
    crime: h.crime ? { text: `Crime ${crimeText(h.crime)}`, high: h.crime.level === "high" || h.crime.level === "very high" } : null,
    allIn: costs ? allInLine(h, costs) : null,
    vsArea: vsArea(h, x.medians),
    vsNow: x.now ? vsNow(h, x.now, places) : null,
    market: onMarket(h),
    also: [
      ...also.map((o) => ({ agent: o.agent, rent: `${pounds(o.pricePcm)} pcm`, url: o.url, sure: true })),
      ...(x.dupes.get(h.id) ?? []).filter((c) => !c.sure).map((c) => ({ agent: c.home.agent, rent: `${pounds(c.home.pricePcm)} pcm`, url: c.home.url, sure: false })),
    ],
    facts: [
      ...(r?.bills === "some" && r.billsWhat ? [`Includes ${r.billsWhat}`] : said("bills", r?.bills)),
      ...(d?.availableFrom ? [`Available ${d.availableFrom === "Now" ? "now" : d.availableFrom}`] : []),
      ...(d?.deposit ? [`Deposit ${pounds(d.deposit)}`] : []),
      ...said("livingRoom", r?.livingRoom),
      ...said("garden", r?.garden),
      ...said("pets", r?.pets),
      ...(shop ? [shopText(shop)] : []),
    ],
    flags: [...(depositOver(h) ? [depositOver(h)!] : []), ...redFlagsOf(r?.redFlags ?? [], !!depositOver(h))],
    agent: h.agent,
    phone: d?.phone ?? h.phone,
    listed: formatDay(h.listedAt ?? h.firstSeen, "Europe/London"),
    isNew: fresh(h),
  };
}

// The listings up now, the matches by default (?view=all for every one, ?view=hidden for those the reader
// hid, src/homes.ts hiddenOf; the other two leave those out), filtered by the chips and
// sorted by score (unread last), rent or newest. The chips' counts are over the view, before the chips.
export const getHomesPage = createServerFn({ method: "GET" })
  .validator((data: HomesSearch) => data)
  .handler(async ({ data }): Promise<HomesPage> => {
    gate("/homes");
    const { configs, ...sidebar } = await nav();
    const m = matchOf(configs.get(TASK));
    const places = placesOf(configs.get(TASK));
    const costs = costsOf(configs.get(TASK));
    const now = nowOf(TASK, configs.get(TASK));
    const all = listHomes(TASK);
    const up = all.filter((h) => h.up);
    const scores = scoreConfig(configs.get(TASK));
    const context: Context = { places, costs, medians: rentMedians(up, ceilingOf(configs.get(TASK))), now, dupes: duplicates(up), scores, near: shopsOf(TASK, configs.get(TASK)) };
    const hidden = hiddenOf(up, context.dupes);
    const visible = up.filter((h) => !hidden.has(h.id));
    const scored = new Map(up.map((h) => [h.id, scoreOf(h, scores, context.near)]));
    const score = (h: HomeRow) => scored.get(h.id)?.score ?? -1;
    const inView = data.view === "hidden" ? up.filter((h) => hidden.has(h.id)) : data.view === "all" ? visible : visible.filter((h) => matches(h, m, places));
    const area = data.area?.toUpperCase();
    const chosen = inView.filter(
      (h) =>
        (!data.beds || bedsOf(h) === data.beds) &&
        (!data.epc || data.epc === "any" || epcOf(h) === data.epc) &&
        (!area || areaOf(h) === area) &&
        (!data.bills || billsIncluded(h)) &&
        (!data.fit || score(h) >= scores.good) &&
        (!data.fresh || fresh(h)) &&
        (!data.reduced || reducedFrom(h) !== null) &&
        (!data.safer || (!!h.crime && h.crime.level !== "high" && h.crime.level !== "very high")),
    );
    const sort = data.sort ?? "fit";
    const newest = (a: HomeRow, b: HomeRow) => (b.listedAt ?? b.firstSeen).localeCompare(a.listedAt ?? a.firstSeen);
    // Nearest to the first place with a limit (work); not timed, or over 90 minutes, last.
    const first = places.find((p) => p.max !== undefined)?.name ?? "";
    const minutes = (h: HomeRow) => h.commute[first]?.min ?? Infinity;
    // Cheapest all in: those priced in full first, since a missing part makes a listing look cheaper.
    const cost = (h: HomeRow) => {
      const a = costs ? allIn(h, costs) : null;
      return a ? (a.missing.length ? 100_000 : 0) + a.total : h.pricePcm;
    };
    chosen.sort((a, b) =>
      sort === "rent"
        ? a.pricePcm - b.pricePcm
        : sort === "allin"
          ? cost(a) - cost(b)
        : sort === "new"
          ? newest(a, b)
          : sort === "near"
            ? minutes(a) - minutes(b) || a.pricePcm - b.pricePcm
            : score(b) - score(a) || a.pricePcm - b.pricePcm || newest(a, b),
    );
    // The same home from several agents (only when sure) shows once, in the row of the first of them in this order.
    const shown: HomeRow[] = [];
    const alsoOf = new Map<string, HomeRow[]>();
    for (const h of chosen) {
      const first = shown.find((k) => (context.dupes.get(h.id) ?? []).some((c) => c.sure && c.home.id === k.id));
      if (first) alsoOf.set(first.id, [...(alsoOf.get(first.id) ?? []), h]);
      else shown.push(h);
    }
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
      good: scores.good,
      limits: places.filter((p) => p.max !== undefined).map((p) => `${p.max} minutes to ${p.name}`),
      up: visible.length,
      matching: visible.filter((h) => matches(h, m, places)).length,
      hidden: hidden.size,
      // A listing hidden directly is never read (src/db.ts unreadHomes).
      unread: up.filter((h) => h.details && !h.read && !h.hidden).length,
      noPage: up.filter((h) => !h.details).length,
      shown: shown.length,
      folded: chosen.length - shown.length,
      now: now ? nowLine(now, places) : null,
      homes: (data.more ? shown : shown.slice(0, LIMIT)).map((h) => item(h, context, alsoOf.get(h.id) ?? [], scored.get(h.id) ?? null)),
      areas: [...byArea].map(([a, n]) => ({ area: a, count: n })).sort((a, b) => Number(a.area.slice(2)) - Number(b.area.slice(2))),
      counts: { beds: count(["0", "1", "2", "3"], bedsOf), epc: count(["good", "unknown", "poor"], epcOf) },
      lastRun: lastSeen && ago(lastSeen),
      swept: swept ? ago(swept) : undefined,
    };
  });
