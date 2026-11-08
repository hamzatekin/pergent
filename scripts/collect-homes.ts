// Collects rental listings from Rightmove for the homes task. Every listing the searches find goes to
// homes.json in the current directory with what the search results say, plus the listing's own page for
// the listings that have none yet, and the runner saves the file to the database's homes table. Under
// $TASK_DIR/task.json's "collect":
//   search         the search as Rightmove's own URL has it (locationIdentifier, radius, maxPrice,
//                  dontShow, includeLetAgreed...): build it on the site and copy the parameters
//   bands          prices that split a sweep, since a Rightmove search stops at 42 pages (1,008 listings)
//   sweepHours     how old the last complete sweep may be before this run sweeps again (default 20). A
//                  sweep reads every band to its last page, which is how a listing that has gone is told
//                  apart. Any other run reads only the newest pages (newest first, where a reduced rent
//                  counts as new) until a page brings nothing new, at most `quickPages` (default 5)
//   delayMs        the wait between two requests to Rightmove (default 2000), which go one at a time
//   maxPages       listing pages fetched a run (default 100), newest listing first
//   budgetSeconds  when to stop fetching (default 240, inside the runner's 5 minutes for a before)
// A search page carries its results as JSON (__NEXT_DATA__); a listing page carries its data as one
// flattened JSON array (window.__PAGE_MODEL), which `unflatten` puts back together.
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import type { HomeDetails, HomeListing, HomesFile } from "../src/db.ts";

const TASK_DIR = process.env.TASK_DIR!;
const config = JSON.parse(await readFile(join(TASK_DIR, "task.json"), "utf8"));
const collect = config.collect ?? {};
const search: Record<string, string | number | boolean> = collect.search ?? {};
const SITE = "https://www.rightmove.co.uk";
const PAGE_SIZE = 24;
const MAX_INDEX = 42 * PAGE_SIZE;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const deadline = Date.now() + (collect.budgetSeconds ?? 240) * 1000;
const log: string[] = [];
const say = (line: string) => {
  log.push(line);
  console.log(line);
};

// What the database already holds, and when the last complete sweep started. A fresh deployment has no
// file or table yet.
type Known = { pcm: number; details: boolean; listedAt: string | null; lastSeen: string };
const known = new Map<string, Known>();
let lastSweep: string | null = null;
try {
  const db = new DatabaseSync(join("..", "..", "pergent.db"), { readOnly: true });
  lastSweep = (db.prepare("SELECT value FROM state WHERE key = ?").get(`swept:${basename(TASK_DIR)}`) as { value: string } | undefined)?.value ?? null;
  const rows = db.prepare("SELECT id, price_pcm AS pcm, details_at IS NOT NULL AS details, listed_at AS listedAt, last_seen AS lastSeen FROM homes").all();
  for (const r of rows as (Known & { id: string; details: number })[]) known.set(r.id, { ...r, details: Boolean(r.details) });
  db.close();
} catch (err) {
  say(`no homes read from the database: ${err instanceof Error ? err.message : err}`);
}

// One request at a time, `delayMs` apart. A 403 or 429 means Rightmove is pushing back, and the run stops
// asking rather than keep at it.
let blocked = "";
let last = 0;
async function get(url: string): Promise<string> {
  if (blocked) throw new Error(`blocked (${blocked})`);
  const wait = last + (collect.delayMs ?? 2000) - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 403 || res.status === 429) blocked = `${res.status} ${res.statusText}`;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function text(html: string) {
  return decode(html.replace(/<(br|\/p|p|\/li|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// --- Search pages ---

type Result = {
  id: number;
  displayAddress: string;
  location?: { latitude?: number; longitude?: number };
  price: { amount: number; frequency: string };
  bedrooms?: number;
  bathrooms?: number;
  propertySubType?: string;
  customer?: { branchDisplayName?: string; contactTelephone?: string };
  propertyImages?: { mainImageSrc?: string };
  summary?: string;
  firstVisibleDate?: string;
  letAvailableDate?: string | null;
  featuredProperty?: boolean;
};

async function searchPage(params: Record<string, string | number | undefined>, index: number) {
  const all = { ...search, ...params, index };
  const query = new URLSearchParams(Object.entries(all).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
  const html = await get(`${SITE}/property-to-rent/find.html?${query}`);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const results = m && JSON.parse(m[1]).props?.pageProps?.searchResults;
  if (!results?.properties) throw new Error("no search results in the page");
  return { total: Number(String(results.resultCount).replace(/,/g, "")), properties: results.properties as Result[] };
}

const PER_MONTH: Record<string, number> = { monthly: 1, weekly: 52 / 12, daily: 365 / 12, quarterly: 1 / 3, yearly: 1 / 12 };

function listing(r: Result): HomeListing {
  return {
    id: String(r.id),
    url: `${SITE}/properties/${r.id}`,
    address: r.displayAddress.replace(/\s+/g, " ").trim(),
    lat: r.location?.latitude ?? null,
    lng: r.location?.longitude ?? null,
    pricePcm: Math.round(r.price.amount * (PER_MONTH[r.price.frequency] ?? 1)),
    beds: r.bedrooms ?? null,
    baths: r.bathrooms ?? null,
    type: r.propertySubType ?? "",
    agent: r.customer?.branchDisplayName ?? "",
    phone: r.customer?.contactTelephone ?? null,
    image: r.propertyImages?.mainImageSrc?.replace(":443/", "/") ?? null,
    summary: (r.summary ?? "").trim(),
    listedAt: r.firstVisibleDate ?? null,
    availableFrom: r.letAvailableDate ?? null,
  };
}

// Every listing this run's searches found, but for `skipTypes` (a rental search also lists garages,
// parking spaces, land and rooms in shared houses). `add` says how many of a page's listings are new or
// have a new rent, leaving out the featured listing Rightmove pins to the top of every page.
const found = new Map<string, HomeListing>();
const skipTypes = new Set<string>(collect.skipTypes ?? []);
const skipped = new Set<string>();
function add(results: Result[]): number {
  let fresh = 0;
  for (const r of results) {
    const l = listing(r);
    if (skipTypes.has(l.type)) {
      skipped.add(l.id);
      continue;
    }
    const k = known.get(l.id);
    if (!r.featuredProperty && !found.has(l.id) && (!k || k.pcm !== l.pricePcm)) fresh++;
    found.set(l.id, l);
  }
  return fresh;
}

// Every band to its last page. Complete only when no page failed and no band was over the 42 pages a
// search shows, since a listing missing from a sweep is taken to have gone.
async function sweep(): Promise<boolean> {
  const cuts: number[] = collect.bands ?? [];
  const lows = [search.minPrice as number | undefined, ...cuts];
  const highs = [...cuts, search.maxPrice as number | undefined];
  let complete = true;
  for (let b = 0; b < lows.length; b++) {
    const band = { minPrice: lows[b], maxPrice: highs[b], sortType: 6 };
    const name = `£${lows[b] ?? 0}-${highs[b] ?? "any"}`;
    try {
      let total = 0;
      for (let index = 0; index < Math.min(total || 1, MAX_INDEX); index += PAGE_SIZE) {
        if (Date.now() > deadline) throw new Error("out of time");
        const page = await searchPage(band, index);
        total = page.total;
        if (!page.properties.length) break;
        add(page.properties);
      }
      if (total > MAX_INDEX) {
        complete = false;
        say(`band ${name}: ${total} listings, over the ${MAX_INDEX} a search shows; split it in task.json's bands`);
      } else say(`band ${name}: ${total}`);
    } catch (err) {
      complete = false;
      say(`band ${name}: failed, ${err instanceof Error ? err.message : err}`);
    }
  }
  return complete;
}

// The newest pages, until one brings nothing new.
async function newest() {
  const pages = collect.quickPages ?? 5;
  for (let p = 0; p < pages; p++) {
    try {
      const page = await searchPage({ sortType: 6 }, p * PAGE_SIZE);
      const fresh = add(page.properties);
      say(`newest page ${p + 1}: ${fresh} new or repriced`);
      if (!page.properties.length || fresh === 0) return;
    } catch (err) {
      say(`newest page ${p + 1}: failed, ${err instanceof Error ? err.message : err}`);
      return;
    }
  }
}

// --- Listing pages ---

// The page's data is one flat array: the first entry is the root object, and every value inside an
// object or array is the index of another entry (a negative one stands for null or undefined).
function unflatten(flat: unknown[]): unknown {
  const memo = new Map<number, unknown>();
  const at = (n: number): unknown => {
    if (n < 0) return null;
    if (memo.has(n)) return memo.get(n);
    const v = flat[n];
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      memo.set(n, out);
      for (const i of v) out.push(at(i));
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      memo.set(n, out);
      for (const [k, i] of Object.entries(v)) out[k] = at(i as number);
      return out;
    }
    return v;
  };
  return at(0);
}

type Page = {
  status?: { archived?: boolean };
  address?: { outcode?: string | null; incode?: string | null };
  text?: { description?: string };
  keyFeatures?: string[];
  lettings?: { letAvailableDate?: string | null; deposit?: number | string | null; minimumTermInMonths?: number | null; letType?: string | null; furnishType?: string | null };
  livingCosts?: { councilTaxBand?: string | null; councilTaxIncluded?: boolean | null };
  sizings?: { unit?: string; minimumSize?: number | null; maximumSize?: number | null }[];
  epcGraphs?: { url?: string }[];
  floorplans?: { url?: string }[];
  images?: { url?: string }[];
  features?: Record<string, unknown>;
  nearestStations?: { name?: string; distance?: number }[];
  contactInfo?: { telephoneNumbers?: { localNumber?: string | null } };
};

function pageData(html: string): Page {
  const marker = "window.__PAGE_MODEL = ";
  const at = html.indexOf(marker);
  if (at < 0) throw new Error("no __PAGE_MODEL in the page");
  const line = html.slice(at + marker.length, html.indexOf("\n", at)).trim().replace(/;$/, "");
  const root = unflatten(JSON.parse(JSON.parse(line).data)) as { propertyData?: Page };
  if (!root.propertyData) throw new Error("no propertyData in __PAGE_MODEL");
  return root.propertyData;
}

const urls = (list?: { url?: string }[]) => (list ?? []).flatMap((i) => (i.url ? [i.url] : []));
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function details(p: Page): HomeDetails {
  const size = (unit: string) => p.sizings?.find((s) => s.unit === unit);
  const sqm = size("sqm") ?? null;
  const sqft = size("sqft") ?? null;
  const area = sqm ? num(sqm.maximumSize ?? sqm.minimumSize) : sqft ? num(sqft.maximumSize ?? sqft.minimumSize) : null;
  const features: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(p.features ?? {})) {
    if (!Array.isArray(v)) continue;
    const said = v.flatMap((f: { displayText?: string }) => (f?.displayText ? [f.displayText] : []));
    if (said.length) features[k] = said;
  }
  return {
    postcode: p.address?.outcode && p.address?.incode ? `${p.address.outcode} ${p.address.incode}` : null,
    description: text(p.text?.description ?? ""),
    keyFeatures: (p.keyFeatures ?? []).filter((f) => typeof f === "string"),
    furnish: p.lettings?.furnishType ?? null,
    deposit: num(p.lettings?.deposit),
    minTermMonths: num(p.lettings?.minimumTermInMonths),
    letType: p.lettings?.letType ?? null,
    availableFrom: p.lettings?.letAvailableDate ?? null,
    councilTaxBand: p.livingCosts?.councilTaxBand ?? null,
    councilTaxIncluded: Boolean(p.livingCosts?.councilTaxIncluded),
    sqm: area === null ? null : Math.round(sqm ? area : area / 10.764),
    epc: urls(p.epcGraphs),
    floorplans: urls(p.floorplans),
    images: urls(p.images),
    features,
    stations: (p.nearestStations ?? []).flatMap((s) => (s.name ? [{ name: s.name, miles: Math.round((s.distance ?? 0) * 100) / 100 }] : [])),
    phone: p.contactInfo?.telephoneNumbers?.localNumber ?? null,
    archived: Boolean(p.status?.archived),
  };
}

// --- The run ---

const sweepDue = !lastSweep || Date.now() - Date.parse(lastSweep) > (collect.sweepHours ?? 20) * 3_600_000;
const startedAt = new Date().toISOString();
let sweptAt: string | null = null;
if (sweepDue) {
  say(`sweep (last complete one: ${lastSweep ?? "never"})`);
  if (await sweep()) sweptAt = startedAt;
} else await newest();

// The pages still to fetch: listings without one that are still up, newest first. A run that swept knows
// exactly what is up; otherwise what the last sweep saw counts too.
const up = (id: string) => found.has(id) || (!sweptAt && (!lastSweep || (known.get(id)?.lastSeen ?? "") >= lastSweep));
const queue = [...new Set([...found.keys(), ...known.keys()])]
  .filter((id) => !known.get(id)?.details && !skipped.has(id) && up(id))
  .map((id) => ({ id, listedAt: found.get(id)?.listedAt ?? known.get(id)?.listedAt ?? "" }))
  .sort((a, b) => b.listedAt.localeCompare(a.listedAt))
  .slice(0, collect.maxPages ?? 100);
const fetched: Record<string, HomeDetails> = {};
let failed = 0;
for (const { id } of queue) {
  if (Date.now() > deadline || blocked) break;
  try {
    fetched[id] = details(pageData(await get(`${SITE}/properties/${id}`)));
  } catch (err) {
    failed++;
    if (failed <= 5) say(`listing ${id}: ${err instanceof Error ? err.message : err}`);
  }
}

const file: HomesFile = { sweptAt, listings: [...found.values()], details: fetched };
await writeFile("homes.json", JSON.stringify(file));
const fresh = file.listings.filter((l) => !known.has(l.id)).length;
const repriced = file.listings.filter((l) => known.has(l.id) && known.get(l.id)!.pcm !== l.pricePcm).length;
const waiting = [...new Set([...found.keys(), ...known.keys()])].filter((id) => !known.get(id)?.details && !fetched[id] && up(id)).length;
say(`found ${file.listings.length} listings (${fresh} new, ${repriced} with a new rent)${sweptAt ? ", a complete sweep" : sweepDue ? ", the sweep was not complete" : ""}; skipped ${skipped.size} by type`);
say(`fetched ${Object.keys(fetched).length} listing pages, ${failed} failed, ${waiting} waiting for the next runs`);
if (blocked) say(`Rightmove refused a request (${blocked}); stopped asking`);
await writeFile("collect.log", log.join("\n") + "\n");
// A run that found nothing at all, or was turned away, is a failed run on the dashboard.
if (!file.listings.length && !Object.keys(fetched).length) process.exit(1);
if (blocked) process.exit(1);
