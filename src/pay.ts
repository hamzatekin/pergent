// What an advertised salary is worth where the job is, for the Jobs page and the weekly paper. The pay
// after income tax and employee National Insurance (2026/27; Scotland's own bands for a job there, since
// tax follows where you live), less a year's rent of a one-bedroom home in the job's area (ONS, in
// src/rents.json, refreshed by scripts/update-rents.ts), is turned into the salary that would leave the
// same in the reader's home area: "£80k in London is worth £63k in Nottingham". A remote job is taken
// to be done from home. Pension, student loan and other prices are left out; the last ONS measure of
// regional prices (2016) had London about 7% over the UK average, and rent is most of the gap.
import { readFileSync } from "node:fs";

/** Where the reader lives (tasks/jobs-read/profile.md). */
export const HOME = "Nottingham";

type Area = { code: string; region: string; rent: number; month?: string };
const rents = JSON.parse(readFileSync(new URL("./rents.json", import.meta.url), "utf8")) as { source: string; month: string; oneBed: Record<string, Area> };
export const RENTS_MONTH = rents.month;

// Personal allowance £12,570, less £1 for every £2 over £100,000.
const allowance = (gross: number) => Math.max(0, 12_570 - Math.max(0, gross - 100_000) / 2);
// Bands of taxable income (after the allowance): [upper limit, rate].
const BANDS: [number, number][] = [
  [37_700, 0.2],
  [125_140, 0.4],
  [Infinity, 0.45],
];
const SCOTTISH: [number, number][] = [
  [3_967, 0.19],
  [16_956, 0.2],
  [31_092, 0.21],
  [62_430, 0.42],
  [125_140, 0.45],
  [Infinity, 0.48],
];

/** A year's pay after income tax and employee Class 1 National Insurance, 2026/27. */
export function takeHome(gross: number, scotland = false): number {
  let taxable = Math.max(0, gross - allowance(gross));
  let tax = 0;
  let from = 0;
  for (const [to, rate] of scotland ? SCOTTISH : BANDS) {
    tax += Math.max(0, Math.min(taxable, to) - from) * rate;
    from = to;
  }
  const ni = Math.max(0, Math.min(gross, 50_270) - 12_570) * 0.08 + Math.max(0, gross - 50_270) * 0.02;
  return gross - tax - ni;
}

/** `name` is what the advert called it ("Edinburgh"), `area` the ONS area its rent is from ("Lothian"). */
export type Place = { name: string; area: string; rent: number; scotland: boolean };

const area = (name: string, area: string): Place | null => {
  const a = rents.oneBed[area];
  return a ? { name, area, rent: a.rent, scotland: a.region === "Scotland" } : null;
};
// Cities whose ONS area is named otherwise; London is its region's figure, wherever in London the office is.
const ALIASES: Record<string, string> = {
  London: "London",
  Edinburgh: "Lothian",
  Glasgow: "Greater Glasgow",
  Aberdeen: "Aberdeen and Shire",
  Dundee: "Dundee and Angus",
  Belfast: "Belfast BRMA",
  Bristol: "Bristol, City of",
  Bath: "Bath and North East Somerset",
  Brighton: "Brighton and Hove",
  Hove: "Brighton and Hove",
  Newcastle: "Newcastle upon Tyne",
  Hull: "Kingston upon Hull, City of",
  Stoke: "Stoke-on-Trent",
};
// Every local authority and rental market area by the name an advert would use ("Bristol, City of" as
// Bristol), longest first so "Newcastle upon Tyne" wins over Newcastle; the regions and countries are
// left out, since "North West" or "England" says nothing about the rent.
const NAMES = [
  ...Object.entries(rents.oneBed)
    .filter(([, a]) => a.region && a.code !== "")
    .map(([name, a]) => [name.replace(/, City of$/, "").replace(/ BRMA$/, ""), a.region === "London" ? "London" : name] as const),
  ...Object.entries(ALIASES),
].sort(([a], [b]) => b.length - a.length);
const PATTERNS = NAMES.map(([word, name]) => [new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u"), word, name] as const);

/** The first UK place an advert's location names, with its one-bed rent; null when it names none. */
export function placeOf(location: string): Place | null {
  let best: { at: number; word: string; name: string } | null = null;
  for (const [re, word, name] of PATTERNS) {
    const m = re.exec(location);
    if (m && (!best || m.index < best.at)) best = { at: m.index, word, name };
  }
  return best && area(best.name === "London" ? "London" : best.word, best.name);
}

export type Worth = {
  /** Where the money is spent: the job's place, or home for a remote job. */
  place: string;
  /** The ONS area whose rent that is. */
  area: string;
  /** A month's pay after tax, NI and the one-bed rent there. */
  leftMonthly: number;
  rent: number;
  /** The salary that leaves the same at home. */
  atHome: number;
};

/** What a year's gross pay is worth in the reader's home area, or null when the place is not known. */
export function worthAtHome(gross: number, location: string, remote: boolean): Worth | null {
  const home = area(HOME, HOME)!;
  const place = (remote && !/\b(hybrid|office|on-?site)\b/i.test(location) ? null : placeOf(location)) ?? (remote ? home : null);
  if (!place) return null;
  const left = takeHome(gross, place.scotland) - place.rent * 12;
  // takeHome rises with gross, so the home salary leaving the same is found by halving.
  let lo = 0;
  let hi = 1_000_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (takeHome(mid, home.scotland) - home.rent * 12 < left) lo = mid;
    else hi = mid;
  }
  return { place: place.name, area: place.area, leftMonthly: Math.round(left / 12), rent: place.rent, atHome: Math.round(hi) };
}
