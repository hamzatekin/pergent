// Collects rental listings from Rightmove and OpenRent for the homes task. Every listing the searches find
// goes to homes.json in the current directory with what the search results say, plus the listing's own page
// for the listings that have none yet, and the runner saves the file to the database's homes table. The two
// sites are read side by side, each one request at a time. Under $TASK_DIR/task.json's "collect":
//   search         the search as Rightmove's own URL has it (locationIdentifier, radius, maxPrice,
//                  dontShow, includeLetAgreed...): build it on the site and copy the parameters
//   bands          prices that split a sweep, since a Rightmove search stops at 42 pages (1,008 listings)
//   sweepHours     how old the last complete sweep may be before this run sweeps again (default 20). A
//                  sweep reads every band to its last page, which is how a listing that has gone is told
//                  apart. Any other run reads only the newest pages (newest first, where a reduced rent
//                  counts as new) until a page brings nothing new, at most `quickPages` (default 5)
//   delayMs        the wait between two requests to one site (default 2000), which go one at a time
//   maxPages       Rightmove listing pages fetched a run (default 100), newest listing first
//   budgetSeconds  when to stop fetching (default 240, inside the runner's 5 minutes for a before)
//   openrent       OpenRent's search, left out to turn it off: `term` (a postcode district or town, as
//                  typed in its search box), `km` (the radius) and `maxPages` (listing pages fetched a
//                  run, default 40). It keeps to the Rightmove search's maxPrice, live listings only, no
//                  rooms in a shared house and no lets to students only, as the Rightmove search does.
// A Rightmove search page carries its results as JSON (__NEXT_DATA__); a listing page carries its data as
// one flattened JSON array (window.__PAGE_MODEL), which `unflatten` puts back together. OpenRent's search
// page carries every result in script arrays, one request for the whole search; see `openrentSearch`.
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
// file or table yet. An OpenRent listing's search result has no address or title, so the stored ones are
// kept from its page.
type Known = Pick<HomeListing, "address" | "type" | "agent" | "image" | "summary"> & { pcm: number; details: boolean; listedAt: string | null; lastSeen: string };
const known = new Map<string, Known>();
let lastSweep: string | null = null;
try {
  const db = new DatabaseSync(join("..", "..", "pergent.db"), { readOnly: true });
  lastSweep = (db.prepare("SELECT value FROM state WHERE key = ?").get(`swept:${basename(TASK_DIR)}`) as { value: string } | undefined)?.value ?? null;
  const rows = db
    .prepare("SELECT id, price_pcm AS pcm, details_at IS NOT NULL AS details, listed_at AS listedAt, last_seen AS lastSeen, address, type, agent, image, summary FROM homes")
    .all();
  for (const r of rows as (Omit<Known, "details"> & { id: string; details: number })[]) known.set(r.id, { ...r, details: Boolean(r.details) });
  db.close();
} catch (err) {
  say(`no homes read from the database: ${err instanceof Error ? err.message : err}`);
}

// One request at a time to each site, `delayMs` apart. A 403 or 429 means the site is pushing back, and
// the run stops asking it rather than keep at it.
function site(name: string) {
  let last = 0;
  const s = {
    name,
    blocked: "",
    async get(url: string): Promise<string> {
      if (s.blocked) throw new Error(`blocked (${s.blocked})`);
      const wait = last + (collect.delayMs ?? 2000) - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 403 || res.status === 429) s.blocked = `${res.status} ${res.statusText}`;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
  };
  return s;
}
const rightmove = site("Rightmove");
const openrent = site("OpenRent");

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
  const html = await rightmove.get(`${SITE}/property-to-rent/find.html?${query}`);
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

// --- OpenRent ---

// Private landlords' listings, stored as `openrent:<id>`. Many are on Rightmove too, listed by "OpenRent,
// London" with "Property Reference: <id>" in the text, which src/compare.ts uses to show them as one home.
const OPENRENT = "https://www.openrent.co.uk";
const openrentConfig = collect.openrent as { term?: string; km?: number; maxPages?: number } | undefined;
const OPENRENT_ID = "openrent:";
const DAY = 86_400_000;

// The columns of OpenRent's search page this reads. Each is a script array (`var prices = [685, 1200];`),
// one value per listing in PROPERTYIDS' order: flags are 1 or 0, `nonStudents` 0 when only students may
// apply, `islivelistBool` 0 when let agreed, `availableFrom` in days from today (0 or less is now).
const COLUMNS = [
  "PROPERTYIDS", "prices", "bedrooms", "bathrooms", "isstudio", "isshared", "nonStudents", "islivelistBool",
  "PROPERTYLISTLATITUDES", "PROPERTYLISTLONGITUDES", "dateFirstListedMs", "availableFrom",
] as const;
type OpenRentResult = Record<(typeof COLUMNS)[number], string>;

async function openrentSearch(term: string, km: number): Promise<OpenRentResult[]> {
  const query = new URLSearchParams({ term, searchType: "km", area: String(km), isLive: "true" });
  const html = await openrent.get(`${OPENRENT}/properties-to-rent/${encodeURIComponent(term.toLowerCase())}?${query}`);
  const columns = COLUMNS.map((name) => {
    const m = html.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`));
    if (!m) throw new Error(`no ${name} in the search page`);
    return m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).filter((v) => v !== "");
  });
  const n = columns[0].length;
  if (columns.some((c) => c.length !== n)) throw new Error("the search page's arrays are not all the same length");
  return Array.from({ length: n }, (_, i) => Object.fromEntries(COLUMNS.map((name, j) => [name, columns[j][i]])) as OpenRentResult);
}

// A listing's page: its title ("2 Bed Flat, Callum View, NG7"), description, photos, the full postcode (in
// its broadband offers link) and its tables, each row a label and a value or a tick or cross icon (yes or
// no). The EPC comes as a letter in a row, never a chart, so it goes into the key features for the read.
type OpenRentPage = Pick<HomeListing, "address" | "type" | "image" | "summary"> & { details: HomeDetails };

function openrentPage(html: string): OpenRentPage {
  const title = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  if (!title) throw new Error("no title in the page");
  const [kind, ...rest] = title.split(",").map((s) => s.trim());
  const rows = new Map<string, string>();
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length !== 2) continue;
    const label = text(cells[0].replace(/<button[\s\S]*?<\/button>|<template[\s\S]*?<\/template>/g, ""));
    rows.set(label.toLowerCase(), /text-success/.test(cells[1]) ? "yes" : /text-danger/.test(cells[1]) ? "no" : text(cells[1]));
  }
  // The ticks as the read sees them: the tenant preferences and bills; DSS/LHA is set by OpenRent from
  // published allowance rates, not by the landlord, so it says nothing about the home.
  const ticked = ["bills included", "pets allowed", "student friendly", "families allowed", "smokers allowed"];
  const keyFeatures = ticked.flatMap((k) => (rows.has(k) ? [`${k[0].toUpperCase()}${k.slice(1)}: ${rows.get(k)}`] : []));
  const epc = rows.get("epc rating");
  if (epc) keyFeatures.push(`EPC rating: ${epc}`);
  const features: Record<string, string[]> = {};
  for (const k of ["garden", "parking"]) if (rows.has(k)) features[k] = [rows.get(k) === "yes" ? "Yes" : "No"];
  const postcode = decodeURIComponent(html.match(/postCode=([^"&]+)/)?.[1] ?? "").trim().toUpperCase();
  const available = rows.get("available from");
  const said = html.match(/id="descriptionText"[^>]*>\s*<div>([\s\S]*?)<\/div>/);
  // A page this cannot read in full fails, to be fetched again next run, rather than be stored without
  // its EPC, bills or postcode for good: every page has a Rent PCM row, a description and a postcode.
  if (!rows.has("rent pcm") || !said || !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) {
    throw new Error(`could not read its ${!rows.has("rent pcm") ? "tables" : !said ? "description" : "postcode"}`);
  }
  const description = text(said[1]);
  const images = [...new Set([...html.matchAll(/\/\/imagescdn\.openrent\.co\.uk\/listings\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi)].map((m) => `https:${m[0]}`))];
  return {
    address: rest.join(", "),
    type: /^studio/i.test(kind) ? "Studio" : kind.replace(/^\d+\s+bed\s+/i, ""),
    image: images[0] ?? null,
    summary: description.replace(/\s+/g, " ").slice(0, 300),
    details: {
      postcode,
      description,
      keyFeatures,
      furnish: rows.get("furnishing") || null,
      deposit: num(rows.get("deposit")?.replace(/[£,]/g, "")),
      minTermMonths: num(rows.get("preferred minimum tenancy")?.match(/^\d+/)?.[0]),
      letType: null,
      availableFrom: !available ? null : /^(today|now)$/i.test(available) ? "Now" : available,
      councilTaxBand: null,
      councilTaxIncluded: false,
      sqm: null,
      epc: [],
      floorplans: [],
      images,
      features,
      stations: [],
      phone: null,
      archived: false,
    },
  };
}

function openrentListing(r: OpenRentResult, page: Pick<HomeListing, "address" | "type" | "image" | "summary">): HomeListing {
  const days = Number(r.availableFrom);
  const today = Math.floor(Date.now() / DAY) * DAY;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    id: `${OPENRENT_ID}${r.PROPERTYIDS}`,
    url: `${OPENRENT}/${r.PROPERTYIDS}`,
    address: page.address,
    lat: num(r.PROPERTYLISTLATITUDES),
    lng: num(r.PROPERTYLISTLONGITUDES),
    pricePcm: Math.round(Number(r.prices)),
    beds: r.isstudio === "1" ? 0 : num(r.bedrooms),
    baths: num(r.bathrooms),
    type: page.type,
    agent: "OpenRent landlord",
    phone: null,
    image: page.image,
    summary: page.summary,
    listedAt: num(r.dateFirstListedMs) === null ? null : iso(Number(r.dateFirstListedMs)),
    availableFrom: Number.isFinite(days) ? iso(today + Math.max(0, days) * DAY) : null,
  };
}

// The whole search in one request; a listing is stored once its page has been read, newest first, up to
// `maxPages` a run, and a stored one is kept up from the search alone. A failed search leaves OpenRent's
// listings unseen this run: in the day's sweep that hides them until the next run sees them again.
async function openrentRun(fetched: Record<string, HomeDetails>) {
  const { term, km = 8, maxPages = 40 } = openrentConfig ?? {};
  if (!term) return;
  let results: OpenRentResult[];
  try {
    results = await openrentSearch(term, km);
  } catch (err) {
    say(`openrent: search failed, ${err instanceof Error ? err.message : err}`);
    return;
  }
  const maxPrice = Number(search.maxPrice ?? Infinity);
  const wanted = results.filter((r) => r.islivelistBool === "1" && r.isshared === "0" && r.nonStudents !== "0" && Number(r.prices) <= maxPrice);
  const pages: OpenRentResult[] = [];
  let repriced = 0;
  for (const r of wanted) {
    const k = known.get(`${OPENRENT_ID}${r.PROPERTYIDS}`);
    if (!k?.details) pages.push(r);
    else {
      const l = openrentListing(r, k);
      if (k.pcm !== l.pricePcm) repriced++;
      found.set(l.id, l);
    }
  }
  pages.sort((a, b) => Number(b.dateFirstListedMs) - Number(a.dateFirstListedMs));
  let read = 0;
  let failed = 0;
  for (const r of pages.slice(0, maxPages)) {
    if (Date.now() > deadline || openrent.blocked) break;
    try {
      const page = openrentPage(await openrent.get(`${OPENRENT}/${r.PROPERTYIDS}`));
      const l = openrentListing(r, page);
      found.set(l.id, l);
      fetched[l.id] = page.details;
      read++;
    } catch (err) {
      failed++;
      if (failed <= 5) say(`openrent: listing ${r.PROPERTYIDS}: ${err instanceof Error ? err.message : err}`);
    }
  }
  say(`openrent: ${results.length} in the search, ${wanted.length} live, within the rent and not shared or for students only (${wanted.length - pages.length} known, ${repriced} with a new rent)`);
  say(`openrent: read ${read} new listing pages, ${failed} failed, ${pages.length - read} waiting for the next runs`);
  // OpenRent turning the run away is said here but does not fail the run, which Rightmove's listings still make.
  if (openrent.blocked) say(`openrent: refused a request (${openrent.blocked}); stopped asking`);
}

// --- The run ---

const sweepDue = !lastSweep || Date.now() - Date.parse(lastSweep) > (collect.sweepHours ?? 20) * 3_600_000;
const startedAt = new Date().toISOString();
let sweptAt: string | null = null;
const fetched: Record<string, HomeDetails> = {};

// Rightmove's searches, then the pages still to fetch: listings without one that are still up, newest
// first. A run that swept knows exactly what is up; otherwise what the last sweep saw counts too.
const isRightmove = (id: string) => !id.startsWith(OPENRENT_ID);
const up = (id: string) => found.has(id) || (!sweptAt && (!lastSweep || (known.get(id)?.lastSeen ?? "") >= lastSweep));
const toFetch = () => [...new Set([...found.keys(), ...known.keys()])].filter((id) => isRightmove(id) && !known.get(id)?.details && !fetched[id] && !skipped.has(id) && up(id));
let failed = 0;
async function rightmoveRun() {
  if (sweepDue) {
    say(`sweep (last complete one: ${lastSweep ?? "never"})`);
    if (await sweep()) sweptAt = startedAt;
  } else await newest();
  const queue = toFetch()
    .map((id) => ({ id, listedAt: found.get(id)?.listedAt ?? known.get(id)?.listedAt ?? "" }))
    .sort((a, b) => b.listedAt.localeCompare(a.listedAt))
    .slice(0, collect.maxPages ?? 100);
  for (const { id } of queue) {
    if (Date.now() > deadline || rightmove.blocked) break;
    try {
      fetched[id] = details(pageData(await rightmove.get(`${SITE}/properties/${id}`)));
    } catch (err) {
      failed++;
      if (failed <= 5) say(`listing ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

await Promise.all([rightmoveRun(), openrentRun(fetched)]);

const file: HomesFile = { sweptAt, listings: [...found.values()], details: fetched };
await writeFile("homes.json", JSON.stringify(file));
const ours = file.listings.filter((l) => isRightmove(l.id));
const fresh = ours.filter((l) => !known.has(l.id)).length;
const repriced = ours.filter((l) => known.has(l.id) && known.get(l.id)!.pcm !== l.pricePcm).length;
say(`found ${ours.length} Rightmove listings (${fresh} new, ${repriced} with a new rent)${sweptAt ? ", a complete sweep" : sweepDue ? ", the sweep was not complete" : ""}; skipped ${skipped.size} by type`);
say(`fetched ${Object.keys(fetched).filter(isRightmove).length} Rightmove listing pages, ${failed} failed, ${toFetch().length} waiting for the next runs`);
if (rightmove.blocked) say(`Rightmove refused a request (${rightmove.blocked}); stopped asking`);
await writeFile("collect.log", log.join("\n") + "\n");
// A run where Rightmove found nothing, or turned it away, is a failed run on the dashboard, whatever
// OpenRent found: a sweep that cannot finish leaves let homes on the page.
if (!ours.length && !Object.keys(fetched).some(isRightmove)) process.exit(1);
if (rightmove.blocked) process.exit(1);
