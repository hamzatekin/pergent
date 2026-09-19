// Pulls Bundle's (bundle.app) popular list and its main feed into bundle.md in the current directory.
// Bundle has no official API; these are the keyless JSON routes its web client at www.bundle.app calls,
// so they may change or start blocking. Config from $TASK_DIR/task.json under "bundle":
//   hours     lookback window for the feed (default 24)
//   maxPages  feed pages to walk at 20 items each, about 5 hours per page (default 8)
//   maxChars  size cap for bundle.md (default 38000); the oldest feed items are dropped past it
// Also merges each item's imageLink into images.json (article link -> lead image) for the reading view.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Item = { rssDataId: string; title: string; link: string; channel_name: string; pubDate: string; imageLink?: string };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const hours: number = config.bundle?.hours ?? 24;
const maxPages: number = config.bundle?.maxPages ?? 8;
const maxChars: number = config.bundle?.maxChars ?? 38_000;
const since = Date.now() - hours * 3_600_000;
const base = "https://www.bundle.app/api/main";
const headers = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", accept: "application/json" };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}/${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// pubDate has no zone and is Turkey time (UTC+3).
const when = (i: Item) => new Date(i.pubDate + "+03:00");
const line = (i: Item) => `- ${when(i).toISOString().slice(11, 16)} [${i.title.trim()}](${i.link}) — ${i.channel_name}`;

const popular = (await get<{ popular_news: Item[] }>("get-popular?locale=tr&page=/tr")).popular_news;

const feed: Item[] = [];
const seen = new Set(popular.map((i) => i.rssDataId));
let before = "";
for (let page = 0; page < maxPages; page++) {
  const items = await get<Item[]>(`get-feed?locale=tr&page=/tr${before && `&beforeRssDataId=${before}`}`);
  if (!items.length) break;
  for (const i of items) if (!seen.has(i.rssDataId) && when(i).getTime() >= since) feed.push(i), seen.add(i.rssDataId);
  before = items[items.length - 1].rssDataId;
  if (when(items[items.length - 1]).getTime() < since) break;
}
feed.sort((a, b) => when(b).getTime() - when(a).getTime());

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const render = () =>
  [
    `# Bundle (bundle.app) — son ${hours} saat (${stamp} UTC itibarıyla, saatler UTC)`,
    `Bundle, Türkiye'nin en çok kullanılan haber toplayıcı uygulaması. "Popüler" listesi Bundle'ın kendi sıralaması; akış ise takip ettiği kaynakların son haberleri.`,
    `## Bundle popüler\n\n${popular.map(line).join("\n")}`,
    `## Bundle akışı\n\n${feed.map(line).join("\n")}`,
  ].join("\n\n") + "\n";

let text = render();
let dropped = 0;
while (text.length > maxChars && feed.length) {
  feed.pop();
  dropped++;
  text = render();
}
await writeFile("bundle.md", text);

const images: Record<string, string> = JSON.parse(await readFile("images.json", "utf8").catch(() => "{}"));
for (const i of [...popular, ...feed]) if (i.imageLink && !images[i.link]) images[i.link] = i.imageLink;
await writeFile("images.json", JSON.stringify(images));
console.log(`bundle.md: ${popular.length} popular + ${feed.length} feed items, ${dropped} dropped for size`);
