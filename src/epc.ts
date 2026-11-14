// Each homes listing's certificate on the EPC register (get-energy-performance-data.communities.gov.uk,
// a free token in EPC_TOKEN), and what the home would cost a month all in. Rightmove seldom gives the
// house number, so a listing is matched by its postcode and then by its house or flat number when it
// gives one, else by the band and score its EPC chart was read as (several alike flats at one postcode
// are fine, the one with the middle energy cost is kept), else by being the only certificate at the
// postcode; a certificate that disagrees with the band or score read is never taken. The
// certificate's modelled heat for the rooms and for hot water, priced at today's price cap, is the
// energy; council tax is the council's 2026/27 average Band D (parishes included) for the listing's band;
// water is a flat average. The register's own cost figures are left alone, since each certificate prices
// fuel as of the year it was made.
import { CERT_VERSION, epcCert, epcPostcode, homesToCertify, saveEpcCert, saveEpcPostcode, saveHomeCert, type Certificate, type EpcEntry, type HomeCert, type HomeDetails } from "./db.ts";
import type { TaskConfig } from "./runner.ts";

const API = "https://api.get-energy-performance-data.communities.gov.uk/api";
const POSTCODE_DAYS = 30;

type Fuel = { pence: number; standingPence: number };
export type Costs = {
  /** The price cap the prices are from, e.g. "Oct to Dec 2026". */
  prices: string;
  gas: Fuel;
  electricity: Fuel;
  /** Electricity a year for lighting and appliances. */
  appliancesKwh: number;
  /** How much heat a unit of fuel gives: a gas boiler (and anything not electric), and a heat pump. */
  boiler: number;
  heatPump: number;
  waterMonthly: number;
  singlePerson: boolean;
  /** The council's average Band D a year, parish precepts included, by the register's council name. */
  councilTaxBandD: Record<string, number>;
};

export const costsOf = (config: TaskConfig | undefined): Costs | null => (config?.costs as Costs | undefined) ?? null;

const register = (config: TaskConfig) => ({ maxRequests: 1500, maxAlike: 5, ...((config.register ?? {}) as Partial<{ maxRequests: number; maxAlike: number }>) });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The register as a whole is out (no answer, the token refused, a 5xx, or 429 past the retries): the
// run stops looking up. Any other refusal is about one request, and only that listing is skipped.
class RegisterDown extends Error {}

// The register's answer, null when it has nothing (404, or a search with no certificates). A 429 waits.
async function get(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${process.env.EPC_TOKEN}`, accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new RegisterDown(`EPC register did not answer, ${(err as Error).message}`);
    }
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403 || res.status >= 500) throw new RegisterDown(`EPC register answered ${res.status}`);
    if (!res.ok) throw new Error(`EPC register answered ${res.status} for ${path}`);
    const data = ((await res.json().catch(() => ({}))) as { data?: unknown }).data;
    return data && typeof data === "object" && "error" in data ? null : (data ?? null);
  }
  throw new RegisterDown("EPC register kept answering 429");
}

type RawEntry = { certificateNumber: string; addressLine1?: string; addressLine2?: string; addressLine3?: string; addressLine4?: string; uprn?: number | string; currentEnergyEfficiencyBand?: string; registrationDate?: string; council?: string };

const join = (...parts: unknown[]) => parts.filter((p) => typeof p === "string" && p.trim()).join(", ");

async function search(postcode: string): Promise<EpcEntry[]> {
  const rows = ((await get(`/domestic/search?postcode=${encodeURIComponent(postcode)}`)) ?? []) as RawEntry[];
  return rows.map((r) => ({
    number: r.certificateNumber,
    address: join(r.addressLine1, r.addressLine2, r.addressLine3, r.addressLine4),
    uprn: String(r.uprn ?? ""),
    band: r.currentEnergyEfficiencyBand ?? "",
    registered: r.registrationDate ?? "",
    council: r.council ?? "",
  }));
}

// A description is a string, or { value } on older certificates.
const text = (x: unknown): string => (typeof x === "string" ? x : x && typeof x === "object" && "value" in x ? String((x as { value: unknown }).value) : "");
const num = (x: unknown): number | null => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));

async function certificate(number: string): Promise<Certificate | null> {
  const d = (await get(`/certificate?certificate_number=${encodeURIComponent(number)}`)) as Record<string, any> | null;
  if (!d) return null;
  // An existing home's heat is under the first names, a new build's (full SAP) under rhi_new_dwelling.
  const rhi = d.renewable_heat_incentive ?? {};
  const built = rhi.rhi_new_dwelling ?? {};
  return {
    v: CERT_VERSION,
    number,
    address: join(d.address_line_1, d.address_line_2, d.address_line_3),
    registered: String(d.registration_date ?? ""),
    band: String(d.current_energy_efficiency_band ?? "").toUpperCase(),
    score: num(d.energy_rating_current),
    sqm: num(d.total_floor_area),
    heating: (Array.isArray(d.main_heating) ? d.main_heating : []).map((m: { description?: unknown }) => text(m.description)).filter(Boolean).join("; "),
    hotWater: text(d.hot_water?.description),
    spaceKwh: num(rhi.space_heating_existing_dwelling ?? built.space_heating),
    waterKwh: num(rhi.water_heating ?? built.water_heating),
  };
}

const UNIT = new Set(["flat", "apartment", "apt", "unit", "room", "studio", "the"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const numbersIn = (ws: string[]) => ws.filter((w) => /^\d+[a-z]?$/.test(w));
const streetWord = (ws: string[]) => ws.find((w) => /^[a-z]{3,}$/.test(w) && !UNIT.has(w));

// "Flat 6, 26 Magdala Road, Nottingham" → its numbers, 6 and 26, and its street's first word, "magdala":
// a first part with no street in it ("Flat 6", "14b") runs into the next.
function addressKey(address: string): { numbers: string[]; word: string } | null {
  const parts = address.split(",");
  const head = streetWord(words(parts[0])) || !parts[1] ? parts[0] : `${parts[0]} ${parts[1]}`;
  const ws = words(head);
  const word = streetWord(ws);
  const numbers = numbersIn(ws);
  return numbers.length && word ? { numbers, word } : null;
}

// A certificate is the listing's home by address when it has the same numbers, no more and no fewer (a
// listing "14b Hazel Street" is not "Apartment 2, 14B Hazel Street"), and the street's word.
function sameAddress(key: { numbers: string[]; word: string }, address: string): boolean {
  const ws = words(address);
  const numbers = numbersIn(ws);
  return numbers.length === key.numbers.length && key.numbers.every((n) => numbers.includes(n)) && ws.includes(key.word);
}

// The newest certificate of each home at the postcode (a home re-assessed has several).
function latest(entries: EpcEntry[]): EpcEntry[] {
  const by = new Map<string, EpcEntry>();
  for (const e of entries) {
    const key = e.uprn || e.address.toLowerCase();
    const had = by.get(key);
    if (!had || e.registered > had.registered) by.set(key, e);
  }
  return [...by.values()];
}

// A month's energy at today's prices, in pounds: the certificate's heat for the rooms through its main
// heating, its hot water through its own system when that is electric or gas and else the main one, gas
// at the boiler's efficiency (as is anything not electric: a heat network, oil, LPG), electricity at 1,
// or the heat pump's; plus lighting and appliances, and the standing charges. Null without the heat figures.
export function energyOf(c: Certificate, k: Costs): number | null {
  if (c.spaceKwh === null || c.waterKwh === null) return null;
  // The first main heating system: a second (gas radiators with an electric heater) is a small share.
  const first = c.heating.split("; ")[0];
  const main = /heat pump/i.test(first) ? { gas: false, by: k.heatPump } : /electric/i.test(first) ? { gas: false, by: 1 } : { gas: true, by: k.boiler };
  const water = /electric|immersion/i.test(c.hotWater) ? { gas: false, by: 1 } : /gas/i.test(c.hotWater) ? { gas: true, by: k.boiler } : main;
  const gasKwh = (main.gas ? c.spaceKwh / main.by : 0) + (water.gas ? c.waterKwh / water.by : 0);
  const electricKwh = k.appliancesKwh + (main.gas ? 0 : c.spaceKwh / main.by) + (water.gas ? 0 : c.waterKwh / water.by);
  const pence = gasKwh * k.gas.pence + (gasKwh > 0 ? 365 * k.gas.standingPence : 0) + electricKwh * k.electricity.pence + 365 * k.electricity.standingPence;
  return Math.round(pence / 100 / 12);
}

const BAND_SHARE: Record<string, number> = { A: 6 / 9, B: 7 / 9, C: 8 / 9, D: 1, E: 11 / 9, F: 13 / 9, G: 15 / 9, H: 18 / 9 };

// The middle of each band's numbers, for a listing whose EPC gives only its band.
const BAND_MIDDLE: Record<string, number> = { A: 96, B: 86, C: 74, D: 61, E: 46, F: 29, G: 10 };

type Rated = { read?: { epcBand?: string | null; epcScore?: number | null } | null; cert: HomeCert | null };
// A listing's EPC number: the chart's, else the register certificate's when it was matched by the home's
// address or is the only one at the postcode, and has the same band, else the middle of the band.
export function epcNumberOf(h: Rated): { n: number; guessed: boolean } | null {
  const band = h.read?.epcBand;
  if (!band) return null;
  if (h.read?.epcScore) return { n: h.read.epcScore, guessed: false };
  const c = h.cert?.cert;
  if (c?.score && c.band === band && (h.cert?.how === "address" || h.cert?.how === "only")) return { n: c.score, guessed: false };
  return BAND_MIDDLE[band] ? { n: BAND_MIDDLE[band], guessed: true } : null;
}

// What fills a listing's gaps, from what has been collected. Energy, for a listing with no certificate:
// the median heat for the rooms per m² and for hot water of the certificates the register lookups have
// kept (thousands, from the listings' own postcodes) of homes heated the same way (electricity, or
// anything else) with an EPC number near the listing's, for its floor area, or else the median of the
// listings of its kind (flat or house) with as many bedrooms that give one; priced like a certificate.
// Council tax, for a listing that gives no band: the commonest band of the listings of its kind in its
// council that give one (46% of the flats in Nottingham were band A on 2026-11-14, 82% of the houses).
export type Estimates = {
  certs: { electric: boolean; score: number; spacePerM2: number; water: number }[];
  sqm: Map<string, number>;
  bands: Map<string, { band: string; of: number; share: number }>;
  /** `alikeOf`'s answers, by heating and EPC number. */
  memo: Map<string, { spacePerM2: number; water: number; alike: number; within: number } | null>;
};
type Sized = { beds?: number | null; type?: string; details: HomeDetails | null; read?: { sqm?: number | null; heating?: string } | null };
const isFlat = (type = "") => /flat|apartment|maisonette|studio|penthouse|duplex/i.test(type);
const isHouse = (type = "") => /house|terrace|semi|detached|bungalow|cottage|barn/i.test(type);
export const kindOf = (type?: string) => (isFlat(type) ? "flat" : isHouse(type) ? "house" : null);
const sqmOf = (h: Sized) => h.details?.sqm ?? h.read?.sqm ?? null;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const MIN_ALIKE = 30;

export function estimatesOf(certs: Certificate[], homes: (Sized & { cert: HomeCert | null })[]): Estimates {
  const sizes = new Map<string, number[]>();
  const bands = new Map<string, Map<string, number>>();
  for (const h of homes) {
    const kind = kindOf(h.type);
    if (!kind) continue;
    const s = sqmOf(h);
    const key = `${Math.min(h.beds ?? 0, 3)} ${kind}`;
    if (s && s >= 15 && s <= 300) sizes.set(key, [...(sizes.get(key) ?? []), s]);
    const band = h.details?.councilTaxBand?.toUpperCase();
    if (band && BAND_SHARE[band] && h.cert?.council) {
      const by = bands.get(`${kind} ${h.cert.council}`) ?? new Map<string, number>();
      bands.set(`${kind} ${h.cert.council}`, by.set(band, (by.get(band) ?? 0) + 1));
    }
  }
  return {
    certs: certs
      .filter((c) => c.score && c.sqm && c.sqm >= 15 && c.spaceKwh !== null && c.waterKwh !== null)
      .map((c) => ({ electric: /electric/i.test(c.heating.split("; ")[0]) && !/heat pump/i.test(c.heating.split("; ")[0]), score: c.score!, spacePerM2: c.spaceKwh! / c.sqm!, water: c.waterKwh! })),
    sqm: new Map([...sizes].filter(([, s]) => s.length >= 5).map(([key, s]) => [key, median(s)])),
    bands: new Map(
      [...bands].flatMap(([key, by]) => {
        const of = [...by.values()].reduce((a, b) => a + b, 0);
        const [band, n] = [...by].sort((a, b) => b[1] - a[1])[0];
        return of >= 10 ? [[key, { band, of, share: n / of }]] : [];
      }),
    ),
    memo: new Map(),
  };
}

/** How a listing's energy was estimated. A home whose heating is not said is priced as gas: weighting gas and
 * electric by how common each is at its EPC number was no closer (on 113 such listings with a certificate,
 * 2026-11-14: 11% off at the median against 9%, a third of them electric and those 15% under). */
export type EnergyEstimate = { n: number; guessed: boolean; heating: "gas" | "electric" | "not said"; alike: number; within: number; sqm: number; sqmGiven: boolean };

// The median heat a m² for the rooms and hot water of the certificates heated one way (electric or not)
// within 2 of an EPC number, else 4, else 6, once 30 are alike; kept per number, since a page sorting by
// the month's cost asks for many listings with the same number.
function alikeOf(e: Estimates, electric: boolean, n: number): { spacePerM2: number; water: number; alike: number; within: number } | null {
  const key = `${electric} ${n}`;
  if (e.memo.has(key)) return e.memo.get(key) ?? null;
  let found: ReturnType<typeof alikeOf> = null;
  for (const within of [2, 4, 6]) {
    const alike = e.certs.filter((c) => c.electric === electric && Math.abs(c.score - n) <= within);
    if (alike.length < MIN_ALIKE) continue;
    found = { spacePerM2: median(alike.map((c) => c.spacePerM2)), water: median(alike.map((c) => c.water)), alike: alike.length, within };
    break;
  }
  e.memo.set(key, found);
  return found;
}

// A listing's energy a month from `Estimates`, with what it was worked out from, or why there is none.
function estimateEnergy(h: Sized & Rated, k: Costs, e: Estimates): { pounds: number; how: EnergyEstimate } | { why: string } {
  const epc = epcNumberOf(h);
  if (!epc) return { why: "no EPC band was read" };
  const kind = kindOf(h.type);
  // A floor area under 15 m² or over 300 is a misread (a room's size, a block's), so the typical one is taken.
  const given = sqmOf(h);
  const own = given && given >= 15 && given <= 300 ? given : null;
  const sqm = own ?? (kind ? e.sqm.get(`${Math.min(h.beds ?? 0, 3)} ${kind}`) : undefined);
  if (!sqm) return { why: kind ? "no floor area given, and too few like it give one" : "no floor area given, and its type is not a flat or a house" };
  const said = h.read?.heating ?? "not said";
  const electric = said === "electric" || said === "storage heaters";
  const a = alikeOf(e, electric, epc.n);
  if (!a) return { why: `fewer than ${MIN_ALIKE} certificates on the register within 6 of its EPC number` };
  const pounds = energyOf(
    {
      heating: electric ? "Electric storage heaters" : said === "heat pump" ? "Air source heat pump" : "Boiler and radiators, mains gas",
      hotWater: electric ? "Electric immersion" : "From main system",
      spaceKwh: a.spacePerM2 * sqm,
      waterKwh: a.water,
    } as Certificate,
    k,
  );
  if (pounds === null) return { why: "its heating could not be priced" };
  const heating = said === "not said" ? "not said" : electric ? "electric" : "gas";
  return { pounds, how: { n: epc.n, guessed: epc.guessed, heating, alike: a.alike, within: a.within, sqm: Math.round(sqm), sqmGiven: own !== null } };
}

export type AllIn = {
  total: number;
  rent: number;
  energy: number | null;
  /** How the energy was estimated, when no certificate gave it. */
  energyEstimate: EnergyEstimate | null;
  /** Why the energy could not be estimated, when it could not. */
  energyWhyNot: string | null;
  councilTax: number | null;
  /** The band council tax was priced at, and whether it was assumed (the listing gives none). */
  taxBand: string | null;
  taxAssumed: { of: number; share: number } | null;
  water: number;
  billsIn: boolean;
  taxIn: boolean;
  missing: string[];
};

// What the home costs a month: the rent, energy (none when the bills are all in the rent), council tax
// (none when included) and water. With `e`, a listing with no certificate gets its energy estimated and
// one with no band the commonest band of its kind in its council. `missing` names what could not be priced.
export function allIn(h: Sized & Rated & { pricePcm: number; read?: { bills?: string } | null }, k: Costs, e?: Estimates | null): AllIn {
  const billsIn = h.read?.bills === "all";
  const missing: string[] = [];
  let energy: number | null = 0;
  let energyEstimate: EnergyEstimate | null = null;
  let energyWhyNot: string | null = null;
  if (!billsIn) {
    energy = h.cert?.cert ? energyOf(h.cert.cert, k) : null;
    const estimate = energy === null && e ? estimateEnergy(h, k, e) : null;
    if (estimate && "why" in estimate) energyWhyNot = estimate.why;
    else if (estimate) [energy, energyEstimate] = [estimate.pounds, estimate.how];
    if (energy === null) missing.push("energy");
  }
  let councilTax: number | null = 0;
  const given = h.details?.councilTaxBand?.toUpperCase();
  let taxBand: string | null = given && BAND_SHARE[given] ? given : null;
  let taxAssumed: AllIn["taxAssumed"] = null;
  if (!h.details?.councilTaxIncluded) {
    const commonest = !taxBand && e && h.cert?.council ? e.bands.get(`${kindOf(h.type)} ${h.cert.council}`) : undefined;
    if (commonest) [taxBand, taxAssumed] = [commonest.band, { of: commonest.of, share: commonest.share }];
    const bandD = h.cert?.council ? k.councilTaxBandD[h.cert.council] : undefined;
    councilTax = taxBand && bandD ? Math.round((bandD * BAND_SHARE[taxBand] * (k.singlePerson ? 0.75 : 1)) / 12) : null;
    if (councilTax === null) missing.push("council tax");
  }
  const water = billsIn ? 0 : k.waterMonthly;
  const taxIn = !!h.details?.councilTaxIncluded;
  return { total: h.pricePcm + (energy ?? 0) + (councilTax ?? 0) + water, rent: h.pricePcm, energy, energyEstimate, energyWhyNot, councilTax, taxBand, taxAssumed, water, billsIn, taxIn, missing };
}

const pounds = (n: number) => `£${n.toLocaleString("en-GB")}`;

// "About £1,103 a month all in (rent £850, energy £92, council tax £115, water £49)", or "About £1,011 a
// month before energy (…)" when a part could not be priced.
export function allInText(a: AllIn): string {
  const parts = [
    `rent ${pounds(a.rent)}`,
    a.billsIn ? "bills in the rent" : a.energy ? `energy ${a.energyEstimate ? `about ${pounds(a.energy)}, estimated from the EPC${a.energyEstimate.heating === "not said" ? ", heating taken as gas" : ""}` : pounds(a.energy)}` : "",
    a.taxIn ? "council tax in the rent" : a.councilTax ? `council tax ${pounds(a.councilTax)}${a.taxAssumed ? `, band ${a.taxBand} assumed` : ""}` : "",
    a.water ? `water ${pounds(a.water)}` : "",
  ].filter(Boolean);
  const head = a.missing.length ? `About ${pounds(a.total)} a month before ${a.missing.join(" and ")}` : `About ${pounds(a.total)} a month all in`;
  return `${head} (${parts.join(", ")})`;
}

// "52 Templars Court, C 79 (2026-08-25), 52 m², Boiler and radiators, mains gas", and how it was matched.
export function certText(h: HomeCert): string {
  const c = h.cert!;
  const how = h.how === "address" ? "matched by its address" : h.how === "score" ? "matched by its EPC band and score" : "the only certificate at its postcode";
  return [
    `${c.address}, ${c.band}${c.score !== null ? ` ${c.score}` : ""} (${c.registered})`,
    c.sqm ? `${c.sqm} m²` : "",
    c.heating,
    `${how}${h.of > 1 ? `, one of ${h.of} alike` : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
}

// Looks each listing up on the register (see the top of the file), at most `register.maxRequests`
// requests a run; the rest wait for the next. A postcode's search is kept 30 days, a certificate for good.
// `ids`: only these listings (the ones just read, so their message has the chart's match).
export async function certHomes(task: string, config: TaskConfig, ids?: Set<string>): Promise<string> {
  const k = costsOf(config);
  if (!process.env.EPC_TOKEN || !k) return "";
  const { maxRequests, maxAlike } = register(config);
  let requests = 0;
  const entriesOf = async (postcode: string): Promise<EpcEntry[]> => {
    const kept = epcPostcode(postcode);
    if (kept && Date.now() - Date.parse(kept.fetchedAt) < POSTCODE_DAYS * 86_400_000) return kept.entries;
    requests++;
    const entries = await search(postcode);
    saveEpcPostcode(postcode, entries);
    return entries;
  };
  const certOf = async (number: string): Promise<Certificate | null> => {
    const kept = epcCert(number);
    if (kept && (kept.v ?? 0) >= CERT_VERSION) return kept;
    requests++;
    const cert = await certificate(number);
    if (cert) saveEpcCert(cert);
    return cert;
  };
  const tally = { address: 0, score: 0, only: 0, none: 0 };
  const skipped: string[] = [];
  let failed = "";
  let left = 0;
  const lookedBefore = new Date(Date.now() - POSTCODE_DAYS * 86_400_000).toISOString();
  const homes = homesToCertify(task, lookedBefore).filter((h) => !ids || ids.has(h.id));
  for (const [i, h] of homes.entries()) {
    if (requests >= maxRequests) {
      left = homes.length - i;
      break;
    }
    try {
      const all = await entriesOf(h.postcode);
      const homesThere = latest(all);
      const found: HomeCert = { council: all[0]?.council || null, cert: null, how: null, of: 0 };
      // What the read took off its chart or text, when it has been read: a certificate must agree.
      const agrees = (c: Certificate | null) => !!c && (!h.epcBand || c.band === h.epcBand) && (h.epcScore === null || c.score === null || c.score === h.epcScore);
      const key = addressKey(h.address);
      const byAddress = key ? homesThere.filter((e) => sameAddress(key, e.address)) : [];
      const addressed = byAddress.length === 1 ? await certOf(byAddress[0].number) : null;
      if (agrees(addressed)) {
        Object.assign(found, { cert: addressed, how: "address", of: 1 });
      } else if (h.epcBand && h.epcScore !== null) {
        const sameBand = homesThere.filter((e) => e.band === h.epcBand);
        const alike: Certificate[] = [];
        for (let j = 0; j < sameBand.length; j += 6) {
          const certs = await Promise.all(sameBand.slice(j, j + 6).map((e) => certOf(e.number)));
          alike.push(...certs.filter((c): c is Certificate => c?.score === h.epcScore));
        }
        // A certificate far from the listing's floor area is another kind of home (a whole house among flats).
        const sized = alike.filter((c) => !h.sqm || !c.sqm || Math.abs(c.sqm - h.sqm) <= h.sqm * 0.3);
        if (sized.length && sized.length <= maxAlike) {
          // The middle energy cost of those that have one; a certificate without heat figures only when none has.
          const priced = sized.filter((c) => energyOf(c, k) !== null).sort((a, b) => energyOf(a, k)! - energyOf(b, k)!);
          const pool = priced.length ? priced : sized;
          Object.assign(found, { cert: pool[Math.floor((pool.length - 1) / 2)], how: "score", of: sized.length });
        }
      } else if (homesThere.length === 1) {
        const only = await certOf(homesThere[0].number);
        if (agrees(only)) Object.assign(found, { cert: only, how: "only", of: 1 });
      }
      tally[found.how ?? "none"]++;
      saveHomeCert(h.id, found);
    } catch (err) {
      if (err instanceof RegisterDown) {
        failed = `; stopped, ${err.message}`;
        left = homes.length - i;
        break;
      }
      skipped.push(`${h.id}: ${(err as Error).message}`);
    }
  }
  const matched = `matched ${tally.address} by address, ${tally.score} by EPC score, ${tally.only} as the only one, ${tally.none} not`;
  return `${matched}; ${requests} requests${left ? `, ${left} listings wait` : ""}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}${failed}`;
}
