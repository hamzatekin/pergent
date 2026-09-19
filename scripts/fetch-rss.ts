// Pulls the last N hours of headlines from a set of news RSS feeds into one markdown file (default
// haberler.md) in the current directory, grouped the way task.json groups the feeds. Headlines, a
// trimmed description and a link only, no article bodies. Config from $TASK_DIR/task.json under "rss":
//   feeds     [{ name, group, url }]   RSS 2.0 or RDF (DW) feeds; Google News feeds also get the list of
//                                      outlets covering each story from the description
//   hours     lookback window (default 24)
//   files     how many files to spread the groups over (default 1), written as <output>-1.md, -2.md ...;
//             claude's Read truncates big files, so more files means more headlines survive the cap
//   maxChars  size cap per file (default 60000); the biggest feed in a file loses its oldest items first
//   output    file name (default haberler.md)
// Also writes images.json, article link -> lead image URL (media:content, media:thumbnail, enclosure or
// the first <img> in the description), for the reading view; the headline files never mention images.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Feed = { name: string; group: string; url: string };
type Item = { feed: Feed; title: string; url: string; date: Date; desc: string; outlets: string[]; image: string };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const feeds: Feed[] = config.rss?.feeds ?? [];
const hours: number = config.rss?.hours ?? 24;
const maxChars: number = config.rss?.maxChars ?? 60_000;
const output: string = config.rss?.output ?? "haberler.md";
const fileCount: number = config.rss?.files ?? 1;
const since = Date.now() - hours * 3_600_000;

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdata ? cdata[1] : unescape(v)).trim();
}

function image(chunk: string, description: string): string {
  const m =
    chunk.match(/<(?:media:content|media:thumbnail|enclosure)[^>]*\burl="([^"]+)"/) ??
    unescape(description).match(/<img[^>]*\bsrc="([^"]+)"/);
  // BBC (240px) and Halk TV / Artı Gerçek (150x84) put thumbnails in the feed; the same paths serve larger sizes.
  return m ? m[1].replace("ichef.bbci.co.uk/ace/ws/240/", "ichef.bbci.co.uk/ace/ws/800/").replace(/\/150\/84\//, "/800/450/") : "";
}

function plain(html: string, max: number): string {
  const text = unescape(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

const byFeed = new Map<Feed, Item[]>();
const failed: string[] = [];
await Promise.all(
  feeds.map(async (feed) => {
    try {
      // Anadolu Ajansı resets the connection unless the request looks like a real browser.
      const headers = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", accept: "*/*", "accept-language": "tr-TR,tr;q=0.9" };
      const res = await fetch(feed.url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const xml = await res.text();
      const google = feed.url.includes("news.google.com");
      const items: Item[] = [];
      for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
        const url = tag(chunk, "link") || tag(chunk, "guid");
        const date = new Date(tag(chunk, "pubDate") || tag(chunk, "dc:date"));
        if (!url || Number.isNaN(date.getTime()) || date.getTime() < since) continue;
        let title = tag(chunk, "title");
        const raw = tag(chunk, "description");
        let desc = plain(raw, 160);
        let outlets: string[] = [];
        if (google) {
          // Google News titles end with " - Outlet"; the description lists every outlet covering the story.
          title = title.replace(/\s+-\s+[^-]+$/, "");
          outlets = [...new Set([...unescape(raw).matchAll(/<font[^>]*>([^<]+)<\/font>/g)].map((m) => m[1].trim()))];
          desc = "";
        }
        items.push({ feed, title, url, date, desc, outlets, image: google ? "" : image(chunk, raw) });
      }
      items.sort((a, b) => b.date.getTime() - a.date.getTime());
      byFeed.set(feed, items);
    } catch (err) {
      failed.push(`${feed.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }),
);

function line(i: Item): string {
  const time = i.date.toISOString().slice(11, 16);
  const extra = i.outlets.length ? ` (${i.outlets.length} kaynak: ${i.outlets.join(", ")})` : i.desc ? ` — ${i.desc}` : "";
  return `- ${time} [${i.title}](${i.url})${extra}`;
}

function render(groups: string[]): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const parts = [`# Son ${hours} saatin haber başlıkları (${stamp} UTC itibarıyla, saatler UTC)`];
  for (const group of groups) {
    const sections = feeds
      .filter((f) => f.group === group && byFeed.get(f)?.length)
      .map((f) => `### ${f.name}\n\n${byFeed.get(f)!.map(line).join("\n")}`);
    if (sections.length) parts.push(`## ${group}\n\n${sections.join("\n\n")}`);
  }
  return parts.join("\n\n") + "\n";
}

// Groups are dealt round-robin over the files. Within a file, trim the largest feed's oldest item until
// it fits, so no single busy outlet crowds the rest out.
const groups = [...new Set(feeds.map((f) => f.group))];
const names = fileCount > 1 ? Array.from({ length: fileCount }, (_, i) => output.replace(/(\.md)?$/, `-${i + 1}$1`)) : [output];
let dropped = 0;
for (const [i, name] of names.entries()) {
  const mine = groups.filter((_, g) => g % fileCount === i);
  const inFile = feeds.filter((f) => mine.includes(f.group) && byFeed.has(f)).map((f) => byFeed.get(f)!);
  let text = render(mine);
  while (text.length > maxChars) {
    const biggest = inFile.sort((a, b) => b.length - a.length)[0];
    if (!biggest?.length) break;
    biggest.pop();
    dropped++;
    text = render(mine);
  }
  await writeFile(name, text);
}

const images: Record<string, string> = {};
for (const items of byFeed.values()) for (const i of items) if (i.image) images[i.url] = i.image;
await writeFile("images.json", JSON.stringify(images));

const kept = [...byFeed.values()].reduce((n, items) => n + items.length, 0);
console.log(`${names.join(", ")}: ${kept} headlines from ${byFeed.size}/${feeds.length} feeds, ${dropped} dropped for size, ${failed.length} failed, ${Object.keys(images).length} with images`);
for (const [feed, items] of byFeed) console.log(`  ${feed.name}: ${items.length}`);
for (const f of failed) console.log(`  failed ${f}`);
