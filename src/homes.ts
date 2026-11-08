// The homes task's reading step. scripts/collect-homes.ts stores each Rightmove listing with its page;
// then prepareHomesRead downloads the EPC charts of the listings no read has seen and hands claude each
// listing's text with its charts right under it (the runner sends them as one message), haiku reads
// them, and saveHomesRead stores on each listing its EPC rating, what it says on the things Rightmove
// cannot filter on, and a short note on how it fits the reader (tasks/homes/wants.md). Its score out of
// 10 is counted by code from those facts (src/score.ts).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { placesOf, timeHomes, type Place } from "./commute.ts";
import { ceilingOf, dedupe, depositOver, duplicates, nowOf, onMarket, rentMedians, vsArea, vsNow, type Copy, type Medians, type Now } from "./compare.ts";
import { crimeHomes, crimeText } from "./crime.ts";
import { allIn, allInText, certHomes, certText, costsOf, type Costs } from "./epc.ts";
import { getState, listHomes, markNotified, saveHomeReads, setState, unreadHomes, type Commute, type HomeRead, type HomeRow, type UnreadHome } from "./db.ts";
import type { Part, TaskConfig } from "./runner.ts";
import { scoreConfig, scoreLabel, scoreOf, scoreParts, type ScoreConfig } from "./score.ts";
import { fetchShops, nearestShop, shopsOf, shopText, type Shop } from "./shops.ts";
import { escapeHtml, sendTelegram, telegramOn } from "./telegram.ts";

const BANDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const EPC_FROM = ["chart", "text", "unknown"] as const;
const BILLS = ["all", "some", "none", "not said"] as const;
const PETS = ["yes", "ask", "no", "not said"] as const;
const LIVING = ["separate", "open plan", "none", "not said"] as const;
const GARDEN = ["private", "shared", "none", "not said"] as const;
const HEATING = ["gas", "electric", "storage heaters", "heat pump", "communal", "not said"] as const;
const PARKING = ["private", "on street", "none", "not said"] as const;
const STREET = ["quiet", "busy", "not said"] as const;

// The band an EPC score falls in, as the chart draws them.
export function bandOf(score: number): string {
  return score >= 92 ? "A" : score >= 81 ? "B" : score >= 69 ? "C" : score >= 55 ? "D" : score >= 39 ? "E" : score >= 21 ? "F" : "G";
}

// What the reader is after, from task.json's "match": the rent (higher when every bill is included),
// the bedrooms and the worst EPC band; the commute limits are the `max` of task.json's commute places.
export type Match = { rent: number; rentWithBills: number; minBeds: number; maxBeds: number; epc: string };

export function matchOf(config: TaskConfig | undefined): Match {
  const m: Match = { rent: 850, rentWithBills: 1000, minBeds: 1, maxBeds: 3, epc: "C", ...((config?.match ?? {}) as Partial<Match>) };
  if (!(BANDS as readonly string[]).includes(m.epc)) m.epc = "C";
  return m;
}

// Within the rent (the higher one when every bill is included), the bedrooms, the EPC band, and every
// commute limit the listing has been timed to (one not timed yet does not count against it).
export function matches(h: HomeRow, m: Match, places: Place[]): boolean {
  const rent = h.read?.bills === "all" ? m.rentWithBills : m.rent;
  const beds = h.beds ?? 0;
  const band = h.read?.epcBand;
  const near = places.every((p) => p.max === undefined || !h.commute[p.name] || (h.commute[p.name].min ?? Infinity) <= p.max);
  return h.pricePcm <= rent && beds >= m.minBeds && beds <= m.maxBeds && !!band && band <= m.epc && near;
}

// "2 bed flat"; no bedrooms is a studio, and Rightmove's "Not Specified" type says nothing.
export function titleOf(h: { beds: number | null; type: string }): string {
  const kind = !h.type || h.type === "Not Specified" ? "home" : h.type.toLowerCase();
  if (h.beds) return `${h.beds} bed ${kind}`;
  return kind === "home" || kind === "studio" ? "Studio" : `Studio ${kind}`;
}

// "Work 38 min (bus 68 + tram)" for each place the listing has been timed to, and whether it is over
// the place's limit.
export function commuteTimes(c: Commute, places: Place[]): { name: string; text: string; over: boolean }[] {
  return places
    .filter((p) => c[p.name])
    .map((p) => {
      const { min, via } = c[p.name];
      return {
        name: p.name,
        text: `${p.name} ${min === null ? "over 90 min" : `${min} min`}${via ? ` (${via})` : ""}`,
        over: p.max !== undefined && (min ?? Infinity) > p.max,
      };
    });
}

const readConfig = (config: TaskConfig) => (config.read ?? {}) as { maxListings?: number; descriptionChars?: number };

export function homesReadSchema() {
  const one = (values: readonly string[], description: string) => ({ type: "string", enum: values, description });
  return {
    type: "object",
    required: ["homes"],
    additionalProperties: false,
    properties: {
      homes: {
        type: "array",
        description: "Every listing of listings.md, once each, in any order.",
        items: {
          type: "object",
          required: ["ref", "epcBand", "epcScore", "epcFrom", "bills", "billsWhat", "pets", "livingRoom", "garden", "heating", "parking", "street", "sqm", "redFlags", "fitWhy"],
          additionalProperties: false,
          properties: {
            ref: { type: "string", description: "The listing's ref from listings.md, like h12." },
            epcBand: one([...BANDS, "unknown"], "The current energy rating's band: from the Energy Efficiency Rating chart's Current column when there is a chart, else from the text (\"EPC rating C\"), else unknown. Never guessed from the age or look of the place."),
            epcScore: { type: "integer", description: "The number in the chart's Current column (1 to 100), or the score the text gives. 0 when neither shows a number." },
            epcFrom: one(EPC_FROM, "Where the rating came from: chart, text, or unknown when neither gives it."),
            bills: one(BILLS, "Bills included in the rent: all (gas, electricity, water and usually internet), some (only some of them), none (it says bills are extra), or not said."),
            billsWhat: { type: "string", description: "Which bills are included when some or all are, in a few words (\"all bills and council tax\", \"water only\"); empty otherwise." },
            pets: one(PETS, "Pets: yes (allowed), ask (considered, by arrangement), no, or not said."),
            livingRoom: one(LIVING, "A living room apart from the bedrooms: separate (its own room), open plan (a living area shared with the kitchen), none (a studio, or a room let on its own), or not said."),
            garden: one(GARDEN, "A garden or yard: private, shared (communal), none, or not said. A balcony is not a garden."),
            heating: one(HEATING, "How the home is heated: gas (a gas boiler or gas central heating), electric (electric heaters or electric central heating), storage heaters, heat pump, communal (a shared or district system), or not said."),
            parking: one(PARKING, "Parking of the home's own: private (a driveway, garage, allocated or off-street space, a residents' car park), on street (or by permit), none, or not said."),
            street: one(STREET, "The street, only as the listing describes it: quiet (a quiet or residential street, a cul-de-sac), busy (a main road, above shops, bars or takeaways), or not said."),
            sqm: { type: "integer", description: "The floor area in square metres when the listing gives one (square feet divided by 10.764, rounded). 0 when it gives none." },
            redFlags: {
              type: "array",
              items: { type: "string" },
              description: "What would put a tenant off that the listing itself says, a few words each: students only, a room in a shared house, a short let or holiday let, a high holding fee, damp or repairs, no viewing before paying. At most 4; empty when there is none. Not what it merely leaves out, and not the crime, commute, EPC, rent, size, a studio or a deposit over the legal cap, which are counted elsewhere.",
            },
            fitWhy: { type: "string", description: "How it fits the reader in wants.md, in at most 20 words: what fits and the main drawback, like \"2 bed, EPC C, gas heating; bills extra and no living room\". Where it leaves out something that matters, say so." },
          },
        },
      },
    },
  };
}

const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars)}…` : text);
// The API takes 5 MB an image, counted on the base64, which is a third larger than the file.
const MAX_BYTES = 3_700_000;
// Past 20 images in one request the API refuses any image over 2000 px; a run stops at 20.
const MAX_IMAGES = 20;
// Haiku charges five times as much for a prompt over 100k tokens, and an agent's EPC certificate sent
// as a PDF is 4 to 9 pages, so a batch also closes before MAX_TOKENS by this estimate (`tokensOf`):
// text at half a token a character (0.4 to 0.5 measured on the listings), an image as the API counts
// it, a PDF at 2,000 tokens a page (1,400 to 1,900 measured: its text and a picture of each page). On
// the runs of 2026-11-08 it came out 5 to 15% over the real count.
const MAX_TOKENS = 90_000;
// The GOV.UK register's certificate page, which some agents link instead of a chart.
const REGISTER = "find-energy-certificate.service.gov.uk";

// What a chart is, from its first bytes rather than the Content-Type: Rightmove serves at least one PNG as
// image/jpeg, and the API refuses an image whose bytes are not the type it is sent as. Null for anything
// the model does not read, such as an agent's HTML page.
function sniff(b: Buffer): { mediaType: string; ext: string } | null {
  const head = b.subarray(0, 12).toString("latin1");
  if (head.startsWith("\x89PNG")) return { mediaType: "image/png", ext: "png" };
  if (head.startsWith("\xff\xd8\xff")) return { mediaType: "image/jpeg", ext: "jpg" };
  if (head.startsWith("GIF8")) return { mediaType: "image/gif", ext: "gif" };
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return { mediaType: "image/webp", ext: "webp" };
  if (head.startsWith("%PDF-")) return { mediaType: "application/pdf", ext: "pdf" };
  return null;
}

// An image's tokens as the API counts them: width × height / 750, after shrinking it to 1568 px on the
// long side and 1.15 megapixels; the size from a PNG's, GIF's or JPEG's header, else the most an image
// can cost. A PDF's pages are its page objects (else its page tree's count, else 10).
export function tokensOf(b: Buffer, mediaType: string): number {
  if (mediaType === "application/pdf") {
    const text = b.toString("latin1");
    const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length || Math.max(0, ...[...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))) || 10;
    return pages * 2000;
  }
  let size: [number, number] | null = null;
  if (mediaType === "image/png" && b.length >= 24) size = [b.readUInt32BE(16), b.readUInt32BE(20)];
  else if (mediaType === "image/gif" && b.length >= 10) size = [b.readUInt16LE(6), b.readUInt16LE(8)];
  else if (mediaType === "image/jpeg") {
    // The first start-of-frame marker (C0 to CF, less C4, C8 and CC) holds the height, then the width.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (!size || !size[0] || !size[1]) return 1600;
  const [w, h] = size;
  const s = Math.min(1, 1568 / Math.max(w, h), Math.sqrt(1_150_000 / (w * h)));
  return Math.ceil((w * s * (h * s)) / 750);
}

type Chart = { file: string; mediaType: string; tokens: number };
type Found = { charts: Chart[]; register: string[]; retry: boolean };

// The listing's EPC charts (two at most: the energy one, and the CO2 one some agents add), saved into the
// run directory, and the rating off a GOV.UK certificate page when that is what the agent linked. One
// that is gone or not something the model reads is left out. `retry` when nothing was found and a
// download failed for a reason that passes (a timeout, 429, 5xx): the listing then waits for the next run
// rather than being read as having no chart.
async function charts(dir: string, id: string, urls: string[]): Promise<Found> {
  const found: Found = { charts: [], register: [], retry: false };
  let failed = false;
  for (const [i, url] of urls.slice(0, 2).entries()) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status === 429 || res.status >= 500) failed = true;
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (new URL(res.url).host === REGISTER) {
        const m = bytes.toString("utf8").match(/energy rating is ([A-G]) with a score of (\d{1,3})/);
        if (m) found.register.push(`energy rating ${m[1]}, score ${m[2]}`);
        continue;
      }
      const type = sniff(bytes);
      if (!type || bytes.length > MAX_BYTES) continue;
      const file = join(dir, "epc", `${id}-${i + 1}.${type.ext}`);
      await writeFile(file, bytes);
      found.charts.push({ file, mediaType: type.mediaType, tokens: tokensOf(bytes, type.mediaType) });
    } catch {
      failed = true;
    }
  }
  found.retry = failed && !found.charts.length && !found.register.length;
  return found;
}

function block(ref: string, h: UnreadHome, found: Found, places: Place[], descriptionChars: number, costs: Costs | null, medians: Medians, shops: Shop[] | null): string {
  const d = h.details;
  const said = (label: string, value: unknown) => (value === null || value === undefined || value === "" ? [] : [`${label}: ${value}`]);
  const features = Object.entries(d.features).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ");
  return [
    `### ${ref} · £${h.pricePcm} pcm · ${h.beds ?? "?"} bed ${h.type || "home"} · ${h.address}${d.postcode && !h.address.includes(d.postcode) ? `, ${d.postcode}` : ""}`,
    ...said("Agent", h.agent),
    ...said("Available", d.availableFrom),
    ...said("Furnishing", d.furnish),
    ...said("Deposit", d.deposit === null ? null : `£${d.deposit}`),
    ...said("Deposit check", depositOver(h)),
    ...said("Rent against listings like it up now", vsArea(h, medians)),
    ...said("Minimum term", d.minTermMonths === null ? null : `${d.minTermMonths} months`),
    ...said("Let type", d.letType),
    ...said("Council tax band", d.councilTaxBand),
    ...(d.councilTaxIncluded ? ["Council tax: included in the rent"] : []),
    ...said("Floor area", d.sqm === null ? null : `${d.sqm} m²`),
    ...said("Ticked by the agent", features),
    ...said("Key features", d.keyFeatures.join("; ")),
    ...said("By bus, tram and walking, door to door", commuteTimes(h.commute, places).map((t) => t.text).join(", ")),
    ...said("Crime around it (police records, against the other listings in this search)", h.crime ? crimeText(h.crime) : null),
    ...said("Nearest supermarket, as the crow flies (OpenStreetMap)", shops && nearestShop(h.lat, h.lng, shops) ? shopText(nearestShop(h.lat, h.lng, shops)!) : null),
    ...said("Its certificate on the EPC register", h.cert?.cert ? certText(h.cert) : null),
    ...said(
      "A month, estimated (energy for this home at today's prices and water, both unless the bills are in the rent; council tax for one person)",
      costs ? allInText(allIn({ ...h, read: h.bills ? { bills: h.bills } : null }, costs)) : null,
    ),
    "",
    clip(d.description || h.summary, descriptionChars),
    ...found.register.map((r) => `${ref}'s EPC certificate on the GOV.UK register: ${r}.`),
    "",
    found.charts.length ? `${ref}'s EPC chart${found.charts.length > 1 ? "s" : ""}:` : `${ref} has no EPC chart.`,
  ].join("\n");
}

// Times the listings to the commute places (src/commute.ts), then writes wants.md (the reader, whom each
// listing's fit is judged against: the task directory's own wants.md), the EPC charts, listings.md (up to `read.maxListings` listings no read has seen or whose
// rent changed since, kept to see what the model was given) and read.json, the refs saveHomesRead checks
// the answer against. A listing whose chart failed for a passing reason, and those past the 20th image,
// wait for the next run. Returns how many went in, how many wait, what the timing did, and the parts
// claude is sent: each listing's text with its charts right under it.
export async function prepareHomesRead(
  task: string,
  dir: string,
  taskDir: string,
  config: TaskConfig,
): Promise<{ listings: number; waiting: number; notes: string[]; parts: Part[] }> {
  const timed = await timeHomes(task, config);
  const crime = await crimeHomes(task, config).catch((err: Error) => `failed, ${err.message}`);
  const certs = await certHomes(task, config).catch((err: Error) => `failed, ${err.message}`);
  const fetched = await fetchShops(task, config).catch((err: Error) => `failed, ${err.message}`);
  const shops = shopsOf(task, config)?.shops ?? null;
  const costs = costsOf(config);
  const medians = rentMedians(listHomes(task).filter((h) => h.up), ceilingOf(config));
  const places = placesOf(config);
  const wants = await readFile(join(taskDir, "wants.md"), "utf8");
  await writeFile(join(dir, "wants.md"), wants);
  const { maxListings = 40, descriptionChars = 2500 } = readConfig(config);
  // The likely matches are read first: within the higher rent of task.json's "match".
  const unread = unreadHomes(task, (config.match as { rentWithBills?: number } | undefined)?.rentWithBills ?? 1000);
  await mkdir(join(dir, "epc"), { recursive: true });
  const refs: Record<string, string> = {};
  const blocks: string[] = [];
  const parts: Part[] = [];
  let images = 0;
  let tokens = wants.length / 2;
  let full = false;
  // Four downloads at a time, from Rightmove's image server, until the batch is full.
  for (let i = 0; i < unread.length && !full; i += 4) {
    const group = unread.slice(i, i + 4);
    const found = await Promise.all(group.map((h) => charts(dir, h.id, h.details.epc)));
    for (const [j, h] of group.entries()) {
      if (found[j].retry) continue;
      const pictures = found[j].charts.filter((c) => c.mediaType.startsWith("image/")).length;
      const ref = `h${blocks.length + 1}`;
      const text = block(ref, h, found[j], places, descriptionChars, costs, medians, shops);
      const cost = text.length / 2 + found[j].charts.reduce((n, c) => n + c.tokens, 0);
      if (blocks.length >= maxListings || images + pictures > MAX_IMAGES || (blocks.length > 0 && tokens + cost > MAX_TOKENS)) {
        full = true;
        break;
      }
      images += pictures;
      tokens += cost;
      refs[ref] = h.id;
      blocks.push(`${text}${found[j].charts.map((c) => `\n(${c.file})`).join("")}`);
      parts.push({ text }, ...found[j].charts);
    }
  }
  const heading = `# Listings to read (${blocks.length})`;
  await writeFile(join(dir, "listings.md"), `${heading}\n\n${blocks.join("\n\n")}\n`);
  await writeFile(join(dir, "read.json"), JSON.stringify({ task, refs }));
  const notes = [
    blocks.length && `about ${Math.round(tokens / 1000)}k tokens`,
    timed && `commute: ${timed}`,
    crime && `crime: ${crime}`,
    certs && `EPC register: ${certs}`,
    fetched && `supermarkets: ${fetched}`,
  ].filter(Boolean) as string[];
  return { listings: blocks.length, waiting: unread.length - blocks.length, notes, parts: [{ text: heading }, ...parts] };
}

type ReadOutput = {
  homes: {
    ref: string;
    epcBand: string;
    epcScore: number;
    epcFrom: string;
    bills: string;
    billsWhat: string;
    pets: string;
    livingRoom: string;
    garden: string;
    heating: string;
    parking: string;
    street: string;
    sqm: number;
    redFlags: string[];
    fitWhy: string;
  }[];
};

const oneOf = <T extends string>(values: readonly T[], value: unknown, otherwise: T): T => (values.includes(value as T) ? (value as T) : otherwise);

// Stores the reads by ref. A listing the answer left out stays unread and comes back next run. A score
// decides the band (the chart's number is read more reliably than its letter). Returns the run's summary
// in markdown, or null when the answer is not a read at all.
export async function saveHomesRead(runId: string, output: unknown, dir: string, config: TaskConfig): Promise<string | null> {
  const out = output as ReadOutput | undefined;
  if (!out || !Array.isArray(out.homes)) return null;
  const { task, refs } = JSON.parse(await readFile(join(dir, "read.json"), "utf8")) as { task: string; refs: Record<string, string> };
  const reads = new Map<string, HomeRead>();
  for (const h of out.homes) {
    const id = refs[h?.ref];
    if (!id || reads.has(id)) continue;
    const score = Number.isInteger(h.epcScore) && h.epcScore >= 1 && h.epcScore <= 100 ? h.epcScore : null;
    const band = score !== null ? bandOf(score) : BANDS.includes(h.epcBand as (typeof BANDS)[number]) ? h.epcBand : null;
    reads.set(id, {
      epcBand: band,
      epcScore: score,
      epcFrom: band ? oneOf(EPC_FROM, h.epcFrom, "text") : "unknown",
      bills: oneOf(BILLS, h.bills, "not said"),
      billsWhat: String(h.billsWhat ?? "").trim().slice(0, 100),
      pets: oneOf(PETS, h.pets, "not said"),
      livingRoom: oneOf(LIVING, h.livingRoom, "not said"),
      garden: oneOf(GARDEN, h.garden, "not said"),
      heating: oneOf(HEATING, h.heating, "not said"),
      parking: oneOf(PARKING, h.parking, "not said"),
      street: oneOf(STREET, h.street, "not said"),
      sqm: Number.isInteger(h.sqm) && h.sqm >= 10 && h.sqm <= 500 ? h.sqm : null,
      redFlags: (Array.isArray(h.redFlags) ? h.redFlags : []).map((f) => String(f).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      fit: null,
      fitWhy: String(h.fitWhy ?? "").trim().slice(0, 200),
    });
  }
  saveHomeReads(runId, reads);
  // The listings just read are matched to the register now, by the score the read took off their chart,
  // so the message about one has its energy.
  const certs = await certHomes(task, config, new Set(reads.keys())).catch((err: Error) => `failed, ${err.message}`);
  const all = [...reads.values()];
  const count = (pick: (r: HomeRead) => string) => {
    const c = new Map<string, number>();
    for (const r of all) c.set(pick(r), (c.get(pick(r)) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  const left = Object.keys(refs).length - reads.size;
  // The scores of the listings just read, as the page counts them (src/score.ts).
  const sc = scoreConfig(config);
  const near = shopsOf(task, config);
  const scored = listHomes(task).filter((h) => reads.has(h.id)).map((h) => scoreOf(h, sc, near)?.score ?? null);
  return [
    `# Read, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${reads.size} listings read${left ? `, ${left} left out of the answer (they come back next run)` : ""}.`,
    "",
    `- EPC: ${count((r) => r.epcBand ?? "unknown")}`,
    `- EPC from: ${count((r) => r.epcFrom)}`,
    `- Bills: ${count((r) => r.bills)}`,
    `- Heating: ${count((r) => r.heating)}`,
    `- Score: ${[...new Set(scored)].sort((a, b) => (b ?? -1) - (a ?? -1)).map((v) => `${v === null ? "none" : `${v}/10`} ${scored.filter((x) => x === v).length}`).join(", ")}`,
    ...(certs ? ["", `EPC register: ${certs}`] : []),
    // A message that fails does not fail the run: the reads are saved, and it goes with the next read.
    ...(telegramOn() ? ["", `Messages: ${await notifyHomes(task, config).catch((err: Error) => `failed, ${err.message}`)}`] : []),
  ].join("\n") + "\n";
}

const pounds = (n: number) => `£${n.toLocaleString("en-GB")}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// task.json's "notify": who gets a message (a match with `minBeds` bedrooms or more, or one scoring
// the score's `good` or more), how long after it was first collected a listing still counts as new
// (`newDays`: a changed weight or a new shop can lift a listing's score while it sits on the page, and
// those are not messaged), at most `maxMessages` a run, and `link`, the page the message's button opens.
const notifyConfig = (config: TaskConfig) => ({ minBeds: 2, newDays: 7, maxMessages: 10, link: "", ...((config.notify ?? {}) as Partial<{ minBeds: number; newDays: number; maxMessages: number; link: string }>) });

// The rent before the last change, when the last change was a drop made at or after `since`.
function droppedFrom(h: HomeRow, since: string): number | null {
  const [before, last] = h.prices.slice(-2);
  return before && last && last.at >= since && last.pcm < before.pcm ? before.pcm : null;
}

// What a message compares a listing with (src/compare.ts).
export type Context = { places: Place[]; costs: Costs | null; medians: Medians; now: Now | null; dupes: Map<string, Copy[]>; scores: ScoreConfig; near: { shops: Shop[]; metres: number } | null };

export function message(h: HomeRow, was: number | null, x: Context): string {
  const { places, costs } = x;
  const r = h.read!;
  const d = h.details;
  const sc = scoreOf(h, x.scores, x.near);
  const shop = x.near ? nearestShop(h.lat, h.lng, x.near.shops) : null;
  const facts = [
    r.bills === "all" ? "Bills included" : r.bills === "none" ? "Bills extra" : "",
    d?.furnish ?? "",
    d?.availableFrom ? `Available ${d.availableFrom === "Now" ? "now" : d.availableFrom}` : "",
    d?.deposit ? `Deposit ${pounds(d.deposit)}` : "",
    shop ? shopText(shop) : "",
  ].filter(Boolean);
  return [
    `<b>${pounds(h.pricePcm)} pcm · ${escapeHtml(titleOf(h))}</b>${was ? ` · was ${pounds(was)}` : ""}`,
    `EPC ${r.epcBand}${r.epcScore ? ` ${r.epcScore}` : ""}${sc ? ` · <b>${scoreLabel(sc)}</b>` : ""}`,
    costs ? escapeHtml(allInText(allIn(h, costs))) : "",
    escapeHtml(vsArea(h, x.medians) ?? ""),
    escapeHtml(depositOver(h) ?? ""),
    escapeHtml(h.address),
    commuteTimes(h.commute, places).map((t) => t.text).join(" · "),
    h.crime ? `Crime ${escapeHtml(crimeText(h.crime))}` : "",
    r.fitWhy ? `<i>${escapeHtml(r.fitWhy)}</i>` : "",
    sc ? escapeHtml(scoreParts(sc, true)) : "",
    x.now ? escapeHtml(vsNow(h, x.now, places) ?? "") : "",
    facts.join(" · "),
    escapeHtml(onMarket(h)),
    ...(x.dupes.get(h.id) ?? []).map((c) => `${c.sure ? "Also" : "Maybe also"} listed by ${escapeHtml(c.home.agent)} at ${pounds(c.home.pricePcm)}`),
    [h.agent, h.details?.phone ?? h.phone].filter(Boolean).map((x) => escapeHtml(x!)).join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
}

// Messages the reader on Telegram about each match worth one (`notifyConfig`) that came up since messages
// were turned on (new to the table and to Rightmove: a widened search brings old listings in as new), or
// got cheaper since, once per rent: again only when the rent goes down. A listing whose read is about to
// be redone (another rent, new commute times) or that is not timed to every place with a limit yet waits
// a run, since a message cannot be taken back. The first run
// with a bot only records when messages started and says so with how many match now, since the listings
// already up are on the page. A failed send stops the round; the rest go next run. Returns a line for
// the run's summary.
export async function notifyHomes(task: string, config: TaskConfig): Promise<string> {
  if (!telegramOn()) return "off";
  const n = notifyConfig(config);
  const m = matchOf(config);
  const places = placesOf(config);
  const up = listHomes(task).filter((h) => h.up);
  const matching = up.filter((h) => matches(h, m, places));
  const dupes = duplicates(up);
  const scores = scoreConfig(config);
  const near = shopsOf(task, config);
  const context: Context = { places, costs: costsOf(config), medians: rentMedians(up, ceilingOf(config)), now: nowOf(task, config), dupes, scores, near };
  const score = (h: HomeRow) => scoreOf(h, scores, near)?.score ?? 0;
  const buttons = (url?: string) => [...(url ? [{ text: "Rightmove", url }] : []), ...(n.link ? [{ text: "All matches", url: n.link }] : [])];
  const since = getState(`notify-since:${task}`);
  if (!since) {
    await sendTelegram({
      html: `Homes messages are on. ${matching.length} listing${matching.length === 1 ? "" : "s"} match now. From here on you get a message for each new match worth a look, and for each one that gets cheaper.`,
      buttons: buttons(),
    });
    setState(`notify-since:${task}`, new Date().toISOString());
    return "turned on";
  }
  const timing = !!process.env.TRAVELTIME_APP_ID && !!process.env.TRAVELTIME_API_KEY;
  const settled = (h: HomeRow) => !h.stale && (!timing || places.every((p) => p.max === undefined || h.commute[p.name]));
  // Up on Rightmove at most three days before it was first collected: new there too.
  // and first collected in the last `newDays`.
  const fresh = (h: HomeRow) =>
    h.firstSeen >= since && Date.now() - Date.parse(h.firstSeen) <= n.newDays * 86_400_000 && (!h.listedAt || Date.parse(h.firstSeen) - Date.parse(h.listedAt) <= 3 * 86_400_000);
  const candidates = matching
    .filter((h) => settled(h) && ((h.beds ?? 0) >= n.minBeds || score(h) >= scores.good))
    .filter((h) => (h.notifiedPcm === null ? fresh(h) || droppedFrom(h, since) !== null : h.pricePcm < h.notifiedPcm))
    .sort((a, b) => score(b) - score(a) || a.pricePcm - b.pricePcm);
  // The same home from another agent goes once (src/compare.ts dedupe); a copy held back is marked as
  // messaged with the one sent for it, whose message names it.
  const { send, held } = dedupe(candidates, dupes);
  for (const h of held.get("") ?? []) markNotified(h.id, h.pricePcm);
  const due = send;
  const notified = (h: HomeRow) => {
    markNotified(h.id, h.pricePcm);
    for (const k of held.get(h.id) ?? []) markNotified(k.id, k.pricePcm);
  };
  let sent = 0;
  try {
    for (const h of due.slice(0, n.maxMessages)) {
      if (sent) await sleep(1100);
      await sendTelegram({ html: message(h, h.notifiedPcm ?? droppedFrom(h, since), context), photo: h.image, buttons: buttons(h.url) });
      notified(h);
      sent++;
    }
    const more = due.length - sent;
    if (more > 0) {
      await sleep(1100);
      await sendTelegram({ html: `And ${more} more new match${more === 1 ? "" : "es"} on the page.`, buttons: buttons() });
      for (const h of due.slice(sent)) notified(h);
    }
  } catch (err) {
    return `${sent} sent, then ${(err as Error).message}`;
  }
  return `${due.length ? `${sent} sent${due.length > sent ? `, ${due.length - sent} summed up` : ""}` : "nothing new"}`;
}
