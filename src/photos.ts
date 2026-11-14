// The homes task's photo check (task homes-photos). preparePhotos downloads the photos of the listings no
// check has looked at, at Rightmove's 656x437 size (about 340 tokens each, big enough to see mould), and
// hands claude each listing's line with its photos right under it, as the read does with its EPC charts;
// haiku says per listing whether the bathroom and the kitchen are modern, what a tenant would want fixed
// that the photos show (mould, damp, cracks, broken fittings), and a short note. savePhotos stores it on
// the listing (`photos`), where the page and the message show it and a problem counts as a red flag in the
// score (src/score.ts); then it sends the messages the check held back (src/homes.ts notifyHomes).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homesToPhotograph, savePhotoChecks, type PhotoCheck } from "./db.ts";
import { imageSize, notifyHomes, sniff, titleOf, tokensOf } from "./homes.ts";
import type { Part, TaskConfig } from "./runner.ts";
import { telegramOn } from "./telegram.ts";

// The API refuses a request with over 100 images, and past 20 any image over 2000 px on a side.
const MAX_IMAGES = 90;
const MAX_SIDE = 2000;
// Haiku charges five times as much for a prompt over 100k tokens. Rightmove's smaller photos are about
// 340 tokens, OpenRent's (1280x960, no smaller size) about 1,530, so a batch also closes at this estimate.
const MAX_TOKENS = 90_000;
// The API takes 5 MB an image, counted on the base64, which is a third larger than the file.
const MAX_BYTES = 3_700_000;
// Listings put off in a row (a timeout or 5xx) before the run stops trying more: the server is in trouble.
const MAX_PUT_OFF = 8;
const ROOMS = ["modern", "fine", "dated", "not shown"] as const;
const HEATERS = ["radiators", "electric heaters", "not shown"] as const;

// task.json's "photos": how many of a listing's photos are looked at (agents put the best first, and the
// bathroom is often among the last), and how many listings a run takes at most.
const photosConfig = (config: TaskConfig) => ({ perListing: 15, maxListings: 15, ...((config.photos ?? {}) as Partial<{ perListing: number; maxListings: number }>) });

// Rightmove's photos come at 1024x768; the same path with `_max_656x437` is a third of the tokens.
const smaller = (url: string) => url.replace(/^(https:\/\/media\.rightmove\.co\.uk)\/(property-photo\/.+)\.(jpe?g|png)$/i, "$1/dir/$2_max_656x437.$3");

type Photo = { file: string; mediaType: string; tokens: number };

// A listing's photos saved into the run directory, the smaller size first and the full one when that is
// not there. A photo that is gone, is not an image, or is too big is left out for good. `refused` on a 403
// or 429, the image server pushing back: the run stops asking (as scripts/collect-homes.ts does). `putOff`
// on a timeout or 5xx: the listing waits for the next run whole, so its bathroom photo is not lost to a
// passing failure and stored as not shown.
async function download(dir: string, id: string, urls: string[]): Promise<{ photos: Photo[]; refused: boolean; putOff: boolean }> {
  const photos: Photo[] = [];
  for (const [i, url] of urls.entries()) {
    for (const u of [...new Set([smaller(url), url])]) {
      let res: Response;
      try {
        res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
      } catch {
        return { photos, refused: false, putOff: true };
      }
      if (res.status === 403 || res.status === 429) return { photos, refused: true, putOff: false };
      if (res.status >= 500) return { photos, refused: false, putOff: true };
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const type = sniff(bytes);
      const size = type && imageSize(bytes, type.mediaType);
      if (!type?.mediaType.startsWith("image/") || bytes.length > MAX_BYTES || !size || Math.max(...size) > MAX_SIDE) break;
      const file = join(dir, "photos", `${id.replace(/[^\w-]/g, "_")}-${i + 1}.${type.ext}`);
      await writeFile(file, bytes);
      photos.push({ file, mediaType: type.mediaType, tokens: tokensOf(bytes, type.mediaType) });
      break;
    }
  }
  return { photos, refused: false, putOff: false };
}

// Writes photos.json (each ref's listing and how many photos it sent) and returns the parts: each
// listing's line, then its photos. A listing none of whose photos will download for good is stored as
// looked at with none, so it is not tried again every run.
export async function preparePhotos(
  homes: string,
  dir: string,
  config: TaskConfig,
  homesConfig: TaskConfig,
): Promise<{ listings: number; waiting: number; tokens: number; stored: number; refused: boolean; parts: Part[] }> {
  const { perListing, maxListings } = photosConfig(config);
  const maxRent = (homesConfig.match as { rentWithBills?: number } | undefined)?.rentWithBills ?? 1000;
  const todo = homesToPhotograph(homes, maxRent);
  await mkdir(join(dir, "photos"), { recursive: true });
  const refs: Record<string, { id: string; photos: number }> = {};
  const none = new Map<string, PhotoCheck>();
  const lines: string[] = [];
  const parts: Part[] = [];
  let images = 0;
  let tokens = 0;
  let putOff = 0;
  let refused = false;
  let full = false;
  // Four listings' downloads at a time, from Rightmove's image server, until the batch is full.
  // At most three times `maxListings` listings tried, so photos gone for good cannot walk the whole backlog.
  for (let i = 0; i < Math.min(todo.length, maxListings * 3) && !full && !refused && putOff < MAX_PUT_OFF; i += 4) {
    const group = todo.slice(i, i + 4);
    const found = await Promise.all(group.map((h) => download(dir, h.id, h.images.slice(0, perListing))));
    refused = found.some((f) => f.refused);
    for (const [j, h] of group.entries()) {
      const { photos } = found[j];
      if (found[j].refused || found[j].putOff) {
        putOff += found[j].putOff ? 1 : 0;
        continue;
      }
      putOff = 0;
      if (!photos.length) {
        none.set(h.id, { bathroom: "not shown", kitchen: "not shown", heating: "not shown", problems: [], note: "", photos: 0 });
        continue;
      }
      const ref = `p${lines.length + 1}`;
      const line = `${ref}: ${titleOf(h)}, ${h.address}. ${photos.length} photo${photos.length > 1 ? "s" : ""} of ${h.images.length}:`;
      const cost = line.length / 2 + photos.reduce((n, p) => n + p.tokens, 0);
      if (lines.length >= maxListings || images + photos.length > MAX_IMAGES || (lines.length > 0 && tokens + cost > MAX_TOKENS)) {
        full = true;
        break;
      }
      refs[ref] = { id: h.id, photos: photos.length };
      lines.push(`${line}${photos.map((p) => `\n(${p.file})`).join("")}`);
      parts.push({ text: line }, ...photos);
      images += photos.length;
      tokens += cost;
    }
  }
  const heading = `# Listings to look at (${lines.length})`;
  await writeFile(join(dir, "listings.md"), `${heading}\n\n${lines.join("\n\n")}\n`);
  await writeFile(join(dir, "photos.json"), JSON.stringify({ refs }));
  // More than a couple with no photo and none with one is the image server's doing (its addresses changed),
  // not the listings': nothing is stored for good.
  const stored = lines.length > 0 || none.size <= 2 ? none : new Map<string, PhotoCheck>();
  savePhotoChecks(stored);
  return { listings: lines.length, waiting: todo.length - lines.length - stored.size, tokens: Math.round(tokens), stored: stored.size, refused, parts: [{ text: heading }, ...parts] };
}

export function photosSchema() {
  const room = (name: string) => ({
    type: "string",
    enum: ROOMS,
    description: `The ${name}: modern (fitted in the last ten years or so, current fittings and finishes), fine (older but clean and in good order), dated (old fittings, worn, or in need of updating), or not shown (no photo shows it).`,
  });
  return {
    type: "object",
    required: ["listings"],
    additionalProperties: false,
    properties: {
      listings: {
        type: "array",
        description: "One entry per listing, in the order given.",
        items: {
          type: "object",
          required: ["ref", "bathroom", "kitchen", "heating", "problems", "note"],
          additionalProperties: false,
          properties: {
            ref: { type: "string", description: "The listing's ref, like p3." },
            bathroom: room("bathroom"),
            kitchen: room("kitchen"),
            heating: {
              type: "string",
              enum: HEATERS,
              description:
                "What heats the rooms, as the photos show it: radiators (water-filled panel radiators with pipes and a valve at the bottom, or a boiler on a wall or in a cupboard), electric heaters (wall-mounted electric panel heaters or bulky storage heaters with dials and no pipes), or not shown (no heater can be made out).",
            },
            problems: {
              type: "array",
              items: { type: "string" },
              description:
                "What a tenant would want fixed that the photos show, a few words each naming the room: black mould on the bathroom ceiling, a damp patch or water stain, peeling or bubbling paint or wallpaper, cracks in a wall or ceiling, broken or missing fittings, badly stained or damaged flooring. At most 4; empty when the photos show none. Not old-fashioned decor, furniture, clutter, small marks, or what no photo shows. When unsure, leave it out.",
            },
            note: {
              type: "string",
              description: 'The rest of the home\'s state in the photos in at most 15 words, without repeating the bathroom, kitchen or heating, like "freshly painted, new carpets, bright lounge; no bedroom photo".',
            },
          },
        },
      },
    },
  };
}

type PhotosOutput = { listings: { ref: string; bathroom: string; kitchen: string; heating: string; problems: string[]; note: string }[] };

const oneOf = (values: readonly string[], value: unknown) => (values.includes(value as string) ? (value as string) : "not shown");

// Stores the checks by ref; a listing the answer left out comes back next run. Then sends the messages
// the check held back. Returns the run's summary in markdown, or null when the answer is not a check.
export async function savePhotos(output: unknown, dir: string, homes: string, homesConfig: TaskConfig): Promise<string | null> {
  const out = output as PhotosOutput | undefined;
  if (!out || !Array.isArray(out.listings)) return null;
  const { refs } = JSON.parse(await readFile(join(dir, "photos.json"), "utf8")) as { refs: Record<string, { id: string; photos: number }> };
  const checks = new Map<string, PhotoCheck>();
  for (const l of out.listings) {
    const { id, photos } = refs[l?.ref] ?? {};
    if (!id || checks.has(id)) continue;
    checks.set(id, {
      bathroom: oneOf(ROOMS, l.bathroom),
      kitchen: oneOf(ROOMS, l.kitchen),
      heating: oneOf(HEATERS, l.heating),
      problems: (Array.isArray(l.problems) ? l.problems : []).map((p) => String(p).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      note: String(l.note ?? "").trim().slice(0, 150),
      photos,
    });
  }
  savePhotoChecks(checks);
  // The photos have served: the listing's page still has them, and a backlog run downloads 2 MB.
  await rm(join(dir, "photos"), { recursive: true, force: true });
  const all = [...checks.values()];
  const count = (pick: (c: PhotoCheck) => string) => {
    const c = new Map<string, number>();
    for (const x of all) c.set(pick(x), (c.get(pick(x)) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  };
  const left = Object.keys(refs).length - checks.size;
  return [
    `# Photos, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${checks.size} listings looked at${left ? `, ${left} left out of the answer (they come back next run)` : ""}.`,
    "",
    `- Bathroom: ${count((c) => c.bathroom)}`,
    `- Kitchen: ${count((c) => c.kitchen)}`,
    `- Heating: ${count((c) => c.heating)}`,
    `- Problems: ${all.filter((c) => c.problems.length).length}`,
    ...[...checks].flatMap(([id, c]) => (c.problems.length ? [`  - ${id}: ${c.problems.join("; ")}`] : [])),
    // A message that fails does not fail the run; it goes with the next read or check.
    ...(telegramOn() ? ["", `Messages: ${await notifyHomes(homes, homesConfig).catch((err: Error) => `failed, ${err.message}`)}`] : []),
  ].join("\n") + "\n";
}
