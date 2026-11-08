// The homes task's reading step. scripts/collect-homes.ts stores each Rightmove listing with its page;
// then prepareHomesRead downloads the EPC charts of the listings no read has seen and hands claude each
// listing's text with its charts right under it (the runner sends them as one message), haiku reads
// them, and saveHomesRead stores on each listing its EPC rating, what it says on the things Rightmove
// cannot filter on, and its fit for the reader (tasks/homes/wants.md).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { saveHomeReads, unreadHomes, type HomeRead, type UnreadHome } from "./db.ts";
import type { Part, TaskConfig } from "./runner.ts";

const BANDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const EPC_FROM = ["chart", "text", "unknown"] as const;
const BILLS = ["all", "some", "none", "not said"] as const;
const PETS = ["yes", "ask", "no", "not said"] as const;
const LIVING = ["separate", "open plan", "none", "not said"] as const;
const GARDEN = ["private", "shared", "none", "not said"] as const;
const HEATING = ["gas", "electric", "storage heaters", "heat pump", "communal", "not said"] as const;

// The band an EPC score falls in, as the chart draws them.
export function bandOf(score: number): string {
  return score >= 92 ? "A" : score >= 81 ? "B" : score >= 69 ? "C" : score >= 55 ? "D" : score >= 39 ? "E" : score >= 21 ? "F" : "G";
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
          required: ["ref", "epcBand", "epcScore", "epcFrom", "bills", "billsWhat", "pets", "livingRoom", "garden", "heating", "sqm", "redFlags", "fit", "fitWhy"],
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
            sqm: { type: "integer", description: "The floor area in square metres when the listing gives one (square feet divided by 10.764, rounded). 0 when it gives none." },
            redFlags: {
              type: "array",
              items: { type: "string" },
              description: "What would put a tenant off that the listing itself says, a few words each: students only, a room in a shared house, a short let or holiday let, a high holding fee, damp or repairs, no viewing before paying. At most 4; empty when there is none. Not what it merely leaves out.",
            },
            fit: {
              type: "integer",
              description: "How well the listing fits the reader in wants.md, 1 to 5, as wants.md's own scale says. Judge it on what the listing says; where it leaves something out that matters, say so in fitWhy.",
            },
            fitWhy: { type: "string", description: "Why, in at most 20 words, naming what fits and the main drawback, like \"2 bed, EPC C, gas heating; bills extra and no living room\"." },
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

type Chart = { file: string; mediaType: string };
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
      found.charts.push({ file, mediaType: type.mediaType });
    } catch {
      failed = true;
    }
  }
  found.retry = failed && !found.charts.length && !found.register.length;
  return found;
}

function block(ref: string, h: UnreadHome, found: Found, descriptionChars: number): string {
  const d = h.details;
  const said = (label: string, value: unknown) => (value === null || value === undefined || value === "" ? [] : [`${label}: ${value}`]);
  const features = Object.entries(d.features).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ");
  return [
    `### ${ref} · £${h.pricePcm} pcm · ${h.beds ?? "?"} bed ${h.type || "home"} · ${h.address}${d.postcode && !h.address.includes(d.postcode) ? `, ${d.postcode}` : ""}`,
    ...said("Agent", h.agent),
    ...said("Available", d.availableFrom),
    ...said("Furnishing", d.furnish),
    ...said("Deposit", d.deposit === null ? null : `£${d.deposit}`),
    ...said("Minimum term", d.minTermMonths === null ? null : `${d.minTermMonths} months`),
    ...said("Let type", d.letType),
    ...said("Council tax band", d.councilTaxBand),
    ...(d.councilTaxIncluded ? ["Council tax: included in the rent"] : []),
    ...said("Floor area", d.sqm === null ? null : `${d.sqm} m²`),
    ...said("Ticked by the agent", features),
    ...said("Key features", d.keyFeatures.join("; ")),
    "",
    clip(d.description || h.summary, descriptionChars),
    ...found.register.map((r) => `${ref}'s EPC certificate on the GOV.UK register: ${r}.`),
    "",
    found.charts.length ? `${ref}'s EPC chart${found.charts.length > 1 ? "s" : ""}:` : `${ref} has no EPC chart.`,
  ].join("\n");
}

// Writes wants.md (the reader, whom each listing's fit is judged against: the task directory's own
// wants.md), the EPC charts, listings.md (up to `read.maxListings` listings no read has seen or whose
// rent changed since, kept to see what the model was given) and read.json, the refs saveHomesRead checks
// the answer against. A listing whose chart failed for a passing reason, and those past the 20th image,
// wait for the next run. Returns how many went in, how many wait, and the parts claude is sent: each
// listing's text with its charts right under it.
export async function prepareHomesRead(task: string, dir: string, taskDir: string, config: TaskConfig): Promise<{ listings: number; waiting: number; parts: Part[] }> {
  await writeFile(join(dir, "wants.md"), await readFile(join(taskDir, "wants.md"), "utf8"));
  const { maxListings = 40, descriptionChars = 2500 } = readConfig(config);
  // The likely matches are read first: within the higher rent of task.json's "match".
  const unread = unreadHomes(task, (config.match as { rentWithBills?: number } | undefined)?.rentWithBills ?? 1000);
  await mkdir(join(dir, "epc"), { recursive: true });
  const refs: Record<string, string> = {};
  const blocks: string[] = [];
  const parts: Part[] = [];
  let images = 0;
  let full = false;
  // Four downloads at a time, from Rightmove's image server, until the batch is full.
  for (let i = 0; i < unread.length && !full; i += 4) {
    const group = unread.slice(i, i + 4);
    const found = await Promise.all(group.map((h) => charts(dir, h.id, h.details.epc)));
    for (const [j, h] of group.entries()) {
      if (found[j].retry) continue;
      const pictures = found[j].charts.filter((c) => c.mediaType.startsWith("image/")).length;
      if (blocks.length >= maxListings || images + pictures > MAX_IMAGES) {
        full = true;
        break;
      }
      images += pictures;
      const ref = `h${blocks.length + 1}`;
      refs[ref] = h.id;
      const text = block(ref, h, found[j], descriptionChars);
      blocks.push(`${text}${found[j].charts.map((c) => `\n(${c.file})`).join("")}`);
      parts.push({ text }, ...found[j].charts);
    }
  }
  const heading = `# Listings to read (${blocks.length})`;
  await writeFile(join(dir, "listings.md"), `${heading}\n\n${blocks.join("\n\n")}\n`);
  await writeFile(join(dir, "read.json"), JSON.stringify({ refs }));
  return { listings: blocks.length, waiting: unread.length - blocks.length, parts: [{ text: heading }, ...parts] };
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
    sqm: number;
    redFlags: string[];
    fit: number;
    fitWhy: string;
  }[];
};

const oneOf = <T extends string>(values: readonly T[], value: unknown, otherwise: T): T => (values.includes(value as T) ? (value as T) : otherwise);

// Stores the reads by ref. A listing the answer left out stays unread and comes back next run. A score
// decides the band (the chart's number is read more reliably than its letter). Returns the run's summary
// in markdown, or null when the answer is not a read at all.
export async function saveHomesRead(runId: string, output: unknown, dir: string): Promise<string | null> {
  const out = output as ReadOutput | undefined;
  if (!out || !Array.isArray(out.homes)) return null;
  const { refs } = JSON.parse(await readFile(join(dir, "read.json"), "utf8")) as { refs: Record<string, string> };
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
      sqm: Number.isInteger(h.sqm) && h.sqm >= 10 && h.sqm <= 500 ? h.sqm : null,
      redFlags: (Array.isArray(h.redFlags) ? h.redFlags : []).map((f) => String(f).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      fit: Number.isInteger(h.fit) && h.fit >= 1 && h.fit <= 5 ? h.fit : null,
      fitWhy: String(h.fitWhy ?? "").trim().slice(0, 200),
    });
  }
  saveHomeReads(runId, reads);
  const all = [...reads.values()];
  const count = (pick: (r: HomeRead) => string) => {
    const c = new Map<string, number>();
    for (const r of all) c.set(pick(r), (c.get(pick(r)) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  const left = Object.keys(refs).length - reads.size;
  return [
    `# Read, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${reads.size} listings read${left ? `, ${left} left out of the answer (they come back next run)` : ""}.`,
    "",
    `- EPC: ${count((r) => r.epcBand ?? "unknown")}`,
    `- EPC from: ${count((r) => r.epcFrom)}`,
    `- Bills: ${count((r) => r.bills)}`,
    `- Heating: ${count((r) => r.heating)}`,
    `- Fit: ${count((r) => (r.fit ? `${r.fit}/5` : "none"))}`,
  ].join("\n") + "\n";
}
