// Writes src/rents.json: the average monthly private rent of a one-bedroom home in every local authority
// of England and Wales and every Broad Rental Market Area of Scotland and Northern Ireland, from the
// ONS Price Index of Private Rents (monthly price statistics, the newest month each area has). src/pay.ts
// reads it to say what a salary is worth after tax and rent where the job is. ONS publishes it monthly
// as one XLSX; rents move a few per cent a year, so this is run by hand now and then and committed:
//
//   node scripts/update-rents.ts
//
// No dependency: an XLSX is a zip of XML files, and this reads the two it needs.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const PAGE = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";

// The newest edition's file is the first .xlsx linked from the dataset page.
const page = await (await fetch(PAGE)).text();
const link = /href="([^"]*priceindexofprivaterentsukmonthlypricestatistics[^"]*\.xlsx)"/.exec(page)?.[1];
if (!link) throw new Error("no XLSX link on the dataset page");
const url = new URL(link.replace(/&amp;/g, "&"), PAGE).toString();
const zip = Buffer.from(await (await fetch(url)).arrayBuffer());
console.log(`${url}: ${(zip.length / 1e6).toFixed(1)} MB`);

// The zip's central directory, from its end record, then each named entry inflated.
function entries(buf: Buffer): Map<string, () => string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, () => string>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const files = entries(zip);
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const strings = [...(files.get("xl/sharedStrings.xml")?.() ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
// The data is the biggest sheet ("Table 1"); the others are the cover, contents and notes.
const sheet = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/sheet")).map((n) => files.get(n)!()).sort((a, b) => b.length - a.length)[0];

const col = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const rows: string[][] = [];
for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
  const row: string[] = [];
  for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? "")?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? "")?.[1] ?? "";
    row[col(c[1])] = / t="s"/.test(c[2]) ? strings[Number(v)] : unescape(v);
  }
  rows.push(row);
}
const header = rows.findIndex((r) => r[0] === "Time period");
const names = rows[header];
const at = (name: string) => names.indexOf(name);
const [TIME, CODE, AREA, REGION, ONE_BED] = ["Time period", "Area code", "Area name", "Region or country name", "Rental price one bed"].map(at);

// The newest month with a one-bed figure, per area; ONS marks a missing one [x].
const areas = new Map<string, { code: string; region: string; rent: number; month: number }>();
for (const r of rows.slice(header + 1)) {
  const rent = Number(r[ONE_BED]);
  const month = Number(r[TIME]);
  if (!r[AREA] || !Number.isFinite(rent) || !rent || !Number.isFinite(month)) continue;
  const known = areas.get(r[AREA]);
  if (!known || month > known.month) areas.set(r[AREA], { code: r[CODE], region: r[REGION] === "[z]" ? "" : r[REGION], rent, month });
}
// Excel day numbers count from 30 December 1899.
const iso = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 7);
const newest = Math.max(...[...areas.values()].map((a) => a.month));
const out = {
  source: PAGE,
  month: iso(newest),
  oneBed: Object.fromEntries([...areas].sort(([a], [b]) => a.localeCompare(b)).map(([name, a]) => [name, { code: a.code, region: a.region, rent: a.rent, ...(a.month < newest ? { month: iso(a.month) } : {}) }])),
};
// One area to a line, so a refresh reads as a diff of rents.
const body = Object.entries(out.oneBed).map(([name, a]) => `  ${JSON.stringify(name)}: ${JSON.stringify(a)}`).join(",\n");
await writeFile(join(import.meta.dirname, "..", "src", "rents.json"), `{\n "source": ${JSON.stringify(out.source)},\n "month": "${out.month}",\n "oneBed": {\n${body}\n }\n}\n`);
console.log(`src/rents.json: ${areas.size} areas, ${out.month}; United Kingdom £${out.oneBed["United Kingdom"]?.rent}, London £${out.oneBed["London"]?.rent}, Nottingham £${out.oneBed["Nottingham"]?.rent}`);
