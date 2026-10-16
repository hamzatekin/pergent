// Collects what changed on the UK's "earned settlement" reform of indefinite leave to remain (ILR) into
// settlement.md in the current directory, for the settlement task, and the last paper into last.md. No
// keys. The sources, each under its own key in $TASK_DIR/task.json's "settlement":
//   govuk.pages          GOV.UK pages to watch through the content API (/api/content/<path>): the
//                        consultation, the Skilled Worker appendix, the ILR guide, the statements of
//                        changes collection. Every page is listed every day with when it last changed; a
//                        change this task has not reported before is marked, with its change notes, and a
//                        collection's new documents.
//   govuk.organisations  GOV.UK's search API, newest first: what these organisations published in the
//                        window, kept when the title or description matches `govuk.match` and not
//                        `govuk.skip` (the stream is mostly unrelated: policing, EU Settlement Scheme)
//   parliament           Home Office written statements (whole text; a statement of changes to the
//                        Immigration Rules comes with one) and written answers matching `parliament.match`,
//                        from the questions-statements API; spoken contributions from Hansard's search
//                        for each of `parliament.hansard`
//   news                 Google News RSS for each of `news.queries`, last `days` only: headline, outlet
//                        and date, since the articles themselves are behind redirects
//   statements           for each statement of changes a changed page cites, or new in the collection: the
//                        written statement announcing it and, when new, its explanatory memorandum
//   feeds                RSS of immigration law blogs and the Commons Library, items matching `match`, with
//                        their text
// `days` (default 3) is the window, wide enough for a weekend or a missed run; on a first run the watched
// pages look back `firstDays` (default 14). Every item has an id;
// settlement.json lists the ids delivered (a page's id is its path and last change), and ids in sibling
// runs' settlement.json are not delivered again, so the model sees each change once and the paper can say
// "nothing new" when there is none. last.md is the newest ok paper of this task in full, so the model
// can carry "where things stand" forward and say what moved since.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { toMarkdown, type Paper } from "../src/paper.ts";

type Item = { id: string; group: string; when: Date; title: string; meta: string; body: string; url: string };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const cfg = config.settlement ?? {};
const days: number = cfg.days ?? 3;
const since = Date.now() - days * 86_400_000;
// A first run, with no earlier settlement.json, reports the watched pages' changes of the last two weeks.
const firstSince = Date.now() - (cfg.firstDays ?? 14) * 86_400_000;
const BODY = 3000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const re = (s: string | undefined, fallback: string) => new RegExp(s ?? fallback, "i");
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

// Ids delivered by earlier runs, and the newest ok paper.
const seen = new Set<string>();
const self = basename(resolve("."));
let history = false;
let last: { startedAt: string; paper: Paper } | undefined;
for (const dir of await readdir("..").catch(() => [] as string[])) {
  if (dir === self) continue;
  const ids = await readFile(join("..", dir, "settlement.json"), "utf8").then(JSON.parse, () => null);
  if (ids) {
    history = true;
    for (const id of ids) seen.add(id);
  }
  try {
    const meta = JSON.parse(await readFile(join("..", dir, "meta.json"), "utf8"));
    if (meta.status !== "ok" || (last && last.startedAt > meta.startedAt)) continue;
    last = { startedAt: meta.startedAt, paper: JSON.parse(await readFile(join("..", dir, "output.json"), "utf8")) };
  } catch {}
}

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&pound;/g, "£")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function text(html: string) {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|\/p|p|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const cut = (s: string, n = BODY) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function get(url: string) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}
const getJson = async (url: string) => JSON.parse(await get(url));

// GOV.UK pages: one item each, every day. `changed` says whether this run should report it.
type Page = { path: string; title: string; updated: string; changed: boolean; notes: string[]; newDocs: string[]; url: string; description: string };
async function govukPage(path: string): Promise<Page> {
  const c = await getJson(`https://www.gov.uk/api/content${path}`);
  const updated: string = c.public_updated_at ?? c.updated_at;
  const id = `govuk-page:${path}@${updated}`;
  const fresh = !seen.has(id) && (history || Date.parse(updated) >= firstSince);
  pageIds.push(id);
  // Change notes newer than the last one this task delivered (or in the window, on a first run).
  const lastSeen = [...seen].filter((s) => s.startsWith(`govuk-page:${path}@`)).map((s) => s.split("@")[1]).sort().at(-1);
  const after = lastSeen ? Date.parse(lastSeen) : firstSince;
  const notes = ((c.details?.change_history ?? []) as { note: string; public_timestamp: string }[])
    .filter((n) => Date.parse(n.public_timestamp) > after)
    .slice(0, 5)
    .map((n) => `${day(n.public_timestamp)}: ${n.note.trim()}`);
  const newDocs = ((c.links?.documents ?? []) as { title: string; base_path: string; public_updated_at: string }[])
    .filter((d) => Date.parse(d.public_updated_at) > after)
    .sort((a, b) => b.public_updated_at.localeCompare(a.public_updated_at))
    .slice(0, 5)
    .map((d) => `${day(d.public_updated_at)}: ${d.title} https://www.gov.uk${d.base_path}`);
  return { path, title: c.title, updated, changed: fresh, notes, newDocs, url: `https://www.gov.uk${path}`, description: c.description ?? "" };
}
const pageIds: string[] = [];

async function govukStream(): Promise<Item[]> {
  const params = new URLSearchParams({ order: "-public_timestamp", count: "100", fields: "title,link,public_timestamp,format,description" });
  for (const o of cfg.govuk?.organisations ?? []) params.append("filter_organisations", o);
  const data = await getJson(`https://www.gov.uk/api/search.json?${params}`);
  const match = re(cfg.govuk?.match, "settle|indefinite leave|immigration rules");
  const skip = re(cfg.govuk?.skip, "EU Settlement Scheme|resettlement");
  const watched = new Set<string>(cfg.govuk?.pages ?? []);
  const items: Item[] = [];
  for (const r of data.results ?? []) {
    const when = new Date(r.public_timestamp);
    if (when.getTime() < since || watched.has(r.link)) continue;
    const hay = `${r.title} ${r.description ?? ""}`;
    if (!match.test(hay) || skip.test(r.title)) continue;
    // The page's own description and latest change note say what this update was.
    let note = "";
    try {
      const c = await getJson(`https://www.gov.uk/api/content${r.link}`);
      note = c.details?.change_history?.[0]?.note ?? "";
    } catch {}
    items.push({
      id: `govuk:${r.link}@${r.public_timestamp}`,
      group: "GOV.UK: Home Office, UKVI and MAC publications",
      when,
      title: r.title,
      meta: r.format.replace(/_/g, " "),
      body: [r.description, note && `Change note: ${note}`].filter(Boolean).join("\n"),
      url: `https://www.gov.uk${r.link}`,
    });
  }
  return items;
}

const PQ = "https://questions-statements-api.parliament.uk/api";

// A statement of changes to the Immigration Rules that a changed page cites ("HC 584") or that is new in
// the collection: the Home Office written statement that announced it, which is the minister's summary of
// every change, and for a new one also its explanatory memorandum, which explains each change and whom it
// affects. The day the earned settlement rules are laid, this is the text that matters.
const COLLECTION = "/government/collections/immigration-rules-statement-of-changes";
async function statementOfChanges(hc: string, isNew: boolean): Promise<Item | undefined> {
  const collection = await getJson(`https://www.gov.uk/api/content${COLLECTION}`);
  const doc = (collection.links?.documents ?? []).find((d: any) => new RegExp(`\\bHC ?${hc}\\b`).test(d.title));
  if (!doc) return;
  const made = new Date(Date.parse(`${doc.title.split(",").at(-1)} UTC`) || doc.public_updated_at);
  const parts: string[] = [];
  // Filtered by title here: the API's searchTerm takes half a minute.
  const params = new URLSearchParams({ answeringBodies: "1", madeWhenFrom: day(new Date(made.getTime() - 86_400_000)), madeWhenTo: day(made), take: "50" });
  const announced = ((await getJson(`${PQ}/writtenstatements/statements?${params}`)).results ?? [])
    .map((r: any) => r.value)
    .filter((v: any) => /statement of changes/i.test(v.title));
  const wms = announced.find((v: any) => v.house === "Commons") ?? announced[0];
  if (wms) {
    const full = await getJson(`${PQ}/writtenstatements/statements/${wms.id}`).then((r) => r.value.text, () => wms.text);
    parts.push(`Written statement ${wms.uin}, ${day(wms.dateMade)}:\n${cut(text(full), 10_000)}`);
  }
  if (isNew) {
    const paper = await getJson(`https://www.gov.uk/api/content${doc.base_path}`);
    const em = (paper.details?.attachments ?? []).find((a: any) => /^explanatory memorandum/i.test(a.title) && a.url?.startsWith("/"));
    if (em) {
      const body = await getJson(`https://www.gov.uk/api/content${em.url}`).then((c) => text(c.details?.body ?? ""), () => "");
      if (body) parts.push(`Explanatory memorandum:\n${cut(body, 40_000)}`);
    }
  }
  return {
    id: `statement:HC${hc}`,
    group: "Statements of changes to the Immigration Rules",
    when: made,
    title: doc.title,
    meta: isNew ? "new" : "cited by a changed page",
    body: parts.join("\n\n") || "No written statement found.",
    url: `https://www.gov.uk${doc.base_path}`,
  };
}
async function writtenStatements(): Promise<Item[]> {
  const params = new URLSearchParams({ answeringBodies: "1", madeWhenFrom: day(new Date(since)), take: "50" });
  const data = await getJson(`${PQ}/writtenstatements/statements?${params}`);
  const match = re(cfg.parliament?.match, "settle|indefinite leave|immigration rules");
  return (data.results ?? [])
    .map((r: any) => r.value)
    .filter((v: any) => v.house === "Commons" || !(data.results ?? []).some((o: any) => o.value.house === "Commons" && o.value.title === v.title))
    .filter((v: any) => match.test(`${v.title} ${v.text}`))
    .map((v: any) => ({
      id: `pq-statement:${v.uin}`,
      group: "Parliament: Home Office written statements",
      when: new Date(v.dateMade),
      title: v.title,
      meta: `${v.house}, ${v.uin}`,
      body: cut(text(v.text), 8000),
      url: `https://questions-statements.parliament.uk/written-statements/detail/${day(v.dateMade)}/${v.uin}`,
    }));
}

async function writtenAnswers(): Promise<Item[]> {
  const match = re(cfg.parliament?.match, "settle|indefinite leave|immigration rules");
  const items: Item[] = [];
  for (let skip = 0; skip < 500; skip += 100) {
    const params = new URLSearchParams({ answeringBodies: "1", answeredWhenFrom: day(new Date(since)), take: "100", skip: String(skip) });
    const data = await getJson(`${PQ}/writtenquestions/questions?${params}`);
    for (const { value: v } of data.results ?? []) {
      if (!match.test(`${v.heading} ${v.questionText} ${v.answerText ?? ""}`)) continue;
      // The list cuts answers short; the question's own record has the whole answer.
      let answer = v.answerText ?? "";
      try {
        answer = (await getJson(`${PQ}/writtenquestions/questions/${v.id}`)).value.answerText ?? answer;
      } catch {}
      items.push({
        id: `pq-question:${v.uin}`,
        group: "Parliament: written questions answered by the Home Office",
        when: new Date(v.dateAnswered),
        title: v.heading,
        meta: `${v.house}, ${v.uin}${v.answerIsHolding ? ", holding answer" : ""}`,
        body: `Q: ${text(v.questionText)}\nA: ${cut(text(answer))}`,
        url: `https://questions-statements.parliament.uk/written-questions/detail/${day(v.dateTabled)}/${v.uin}`,
      });
    }
    if ((data.results ?? []).length < 100) break;
  }
  return items;
}

async function hansard(term: string): Promise<Item[]> {
  const params = new URLSearchParams({
    "queryParameters.searchTerm": term,
    "queryParameters.startDate": day(new Date(since)),
    "queryParameters.take": "40",
  });
  const data = await getJson(`https://hansard-api.parliament.uk/search.json?${params}`);
  return (data.Contributions ?? []).map((c: any) => {
    const slug = (c.DebateSection as string).replace(/[^A-Za-z0-9 ]/g, "").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    return {
      id: `hansard:${c.ContributionExtId}`,
      group: `Parliament: Hansard, "${term}"`,
      when: new Date(c.SittingDate),
      title: `${c.DebateSection} (${c.House}, ${c.Section})`,
      meta: c.MemberName ?? c.AttributedTo ?? "",
      body: cut(c.ContributionTextFull ?? c.ContributionText ?? ""),
      url: `https://hansard.parliament.uk/${c.House}/${day(c.SittingDate)}/debates/${c.DebateSectionExtId}/${slug}#contribution-${c.ContributionExtId}`,
    };
  });
}

async function googleNews(query: string): Promise<Item[]> {
  const q = `${query} when:${days}d`;
  const xml = await get(`https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-GB", gl: "GB", ceid: "GB:en" })}`);
  const items: Item[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const url = decode(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const source = decode(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
    const sourceUrl = item.match(/<source url="([^"]+)"/)?.[1] ?? "";
    items.push({
      id: `news:${title.toLowerCase()}`,
      group: "News (Google News)",
      when: new Date(item.match(/<pubDate>([^<]+)</)?.[1] ?? 0),
      title: title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), ""),
      meta: `${source}${sourceUrl ? ` (${sourceUrl})` : ""}`,
      body: "",
      url,
    });
  }
  return items.filter((i) => i.when.getTime() >= since);
}

async function feed(name: string, url: string, match: RegExp): Promise<Item[]> {
  const xml = await get(url);
  const items: Item[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const link = decode(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const html = item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ?? item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
    const body = text(decode(html));
    if (!match.test(`${title} ${body}`)) continue;
    items.push({ id: `feed:${link}`, group: name, when: new Date(item.match(/<pubDate>([^<]+)</)?.[1] ?? 0), title, meta: "", body: cut(body), url: link });
  }
  return items.filter((i) => i.when.getTime() >= since);
}

const found: Item[] = [];
const log: string[] = [];
async function collect(label: string, run: () => Promise<Item[]>) {
  try {
    const items = await run();
    found.push(...items);
    log.push(`${label}: ${items.length}`);
  } catch (err) {
    log.push(`${label}: failed, ${err instanceof Error ? err.message : err}`);
  }
  console.log(log.at(-1));
}

const pages: Page[] = [];
await Promise.all([
  ...(cfg.govuk?.pages ?? []).map(async (path: string) => {
    try {
      pages.push(await govukPage(path));
      console.log(`page ${path}: ok`);
    } catch (err) {
      log.push(`page ${path}: failed, ${err instanceof Error ? err.message : err}`);
      console.log(log.at(-1));
    }
  }),
  collect("GOV.UK publications", govukStream),
  collect("written statements", writtenStatements),
  collect("written answers", writtenAnswers),
  ...(cfg.parliament?.hansard ?? []).map((t: string) => collect(`Hansard "${t}"`, () => hansard(t))),
  ...(cfg.news?.queries ?? []).map((q: string) => collect(`news ${q}`, () => googleNews(q))),
  ...(cfg.feeds ?? []).map((f: { name: string; url: string; match?: string }) =>
    collect(f.name, () => feed(f.name, f.url, re(f.match ?? cfg.feedMatch, "earned settlement|indefinite leave|\\bILR\\b|settlement"))),
  ),
]);

// The statements of changes the changed pages cite, and new ones.
const cited = new Map<string, boolean>();
for (const p of pages.filter((p) => p.changed)) {
  for (const line of [...p.notes, ...p.newDocs]) {
    for (const [, hc] of line.matchAll(/\bHC ?(\d+)/g)) cited.set(hc, cited.get(hc) || p.newDocs.includes(line));
  }
}
await Promise.all(
  [...cited].filter(([hc]) => !seen.has(`statement:HC${hc}`)).map(([hc, isNew]) => collect(`statement of changes HC ${hc}`, async () => {
    const item = await statementOfChanges(hc, isNew);
    return item ? [item] : [];
  })),
);

// New items only, each once even when several queries found it.
const delivered = new Set<string>();
const fresh = found.filter((i) => !seen.has(i.id) && !delivered.has(i.id) && delivered.add(i.id));
const groups = new Map<string, Item[]>();
// Statements of changes first, then each group newest first.
const rank = (i: Item) => (i.id.startsWith("statement:") ? 0 : 1);
for (const i of fresh.sort((a, b) => rank(a) - rank(b) || b.when.getTime() - a.when.getTime())) {
  if (!groups.has(i.group)) groups.set(i.group, []);
  groups.get(i.group)!.push(i);
}

const order = (cfg.govuk?.pages ?? []) as string[];
pages.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
let out = `# Settlement sources, ${day(new Date())} (the last ${days} days, only what earlier papers have not reported)\n\n`;
out += `## Watched GOV.UK pages\n\n`;
for (const p of pages) {
  out += `- ${p.changed ? "**CHANGED** " : ""}${p.title}, last updated ${day(p.updated)}\n  ${p.url}\n`;
  if (p.changed) {
    if (p.description) out += `  ${p.description}\n`;
    for (const n of p.notes) out += `  Change note ${n}\n`;
    for (const d of p.newDocs) out += `  New document ${d}\n`;
  }
}
for (const [group, items] of groups) {
  out += `\n## ${group}\n`;
  for (const i of items) {
    out += `\n### ${day(i.when)}: ${i.title}\n${i.meta ? `${i.meta}\n` : ""}${i.url}\n${i.body ? `${i.body}\n` : ""}`;
  }
}
if (!groups.size) out += `\nNothing new from Parliament, GOV.UK publications, the news or the blogs in the window.\n`;
out += `\n---\nFetched: ${log.join("; ")}\n`;

await writeFile("settlement.md", out);
await writeFile("settlement.json", JSON.stringify([...pageIds, ...fresh.map((i) => i.id)], null, 1));
await writeFile("last.md", last ? `Paper of ${day(last.startedAt)}:\n\n${toMarkdown(last.paper)}\n` : "No earlier paper.\n");
console.log(`settlement: ${pages.filter((p) => p.changed).length} of ${pages.length} pages changed, ${fresh.length} new items, ${out.length} chars; last paper ${last ? day(last.startedAt) : "none"}`);
