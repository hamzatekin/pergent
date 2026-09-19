// Pulls new issues from newsletter RSS feeds into newsletters.md in the current directory.
// An issue is delivered once: the issue URLs of each run are saved to newsletters.json, and the sibling
// run directories (../*/newsletters.json) are scanned to skip issues already delivered. A missed day is
// caught up on the next run without repeats. Config from $TASK_DIR/task.json under "newsletters":
//   feeds     [{ name, url }]   RSS 2.0 feeds; the issue body is taken from content:encoded or description
//   days      lookback window for a never-seen issue (default 7)
//   maxChars  size cap for newsletters.md (default 60000); claude's Read truncates big files, so older
//             issues past the cap are left for the next run instead of being silently cut
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const feeds: { name: string; url: string }[] = config.newsletters?.feeds ?? [];
const days: number = config.newsletters?.days ?? 7;
const maxChars: number = config.newsletters?.maxChars ?? 60_000;
const since = Date.now() - days * 86_400_000;

const seen = new Set<string>();
const runsDir = resolve("..");
for (const dir of await readdir(runsDir).catch(() => [] as string[])) {
  try {
    for (const url of JSON.parse(await readFile(join(runsDir, dir, "newsletters.json"), "utf8")) as string[]) seen.add(url);
  } catch {}
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : unescape(v);
}

// Cooperpress wraps every link in a click tracker (https://<letter>/link/<id>/rss). Follow the redirect
// once so the digest can link straight to the article.
const resolved = new Map<string, Promise<string>>();
function resolveLink(url: string): Promise<string> {
  if (!/\/link\/\d+/.test(url)) return Promise.resolve(url);
  let p = resolved.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) })
      .then((res) => res.headers.get("location") || url)
      .catch(() => url);
    resolved.set(url, p);
  }
  return p;
}

async function htmlToText(html: string): Promise<string> {
  const links: Promise<string>[] = [];
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (!label) return "";
      links.push(resolveLink(href));
      return `${label} (\u0000${links.length - 1}\u0000)`;
    })
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const urls = await Promise.all(links);
  return unescape(text)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)])
    .replace(/[ \t​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Issue = { feed: string; title: string; url: string; date: Date; text: string };

const found: Issue[] = [];
const failed: string[] = [];
await Promise.all(
  feeds.map(async (feed) => {
    try {
      const res = await fetch(feed.url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const xml = await res.text();
      for (const item of xml.split(/<item[\s>]/).slice(1)) {
        const url = tag(item, "link") || tag(item, "guid");
        const date = new Date(tag(item, "pubDate"));
        if (!url || seen.has(url) || Number.isNaN(date.getTime()) || date.getTime() < since) continue;
        const body = tag(item, "content:encoded") || tag(item, "description");
        found.push({ feed: feed.name, title: tag(item, "title"), url, date, text: await htmlToText(body) });
      }
    } catch (err) {
      failed.push(`${feed.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }),
);
found.sort((a, b) => b.date.getTime() - a.date.getTime());

// Newest first up to the cap; anything left over is not marked delivered and comes next run.
const issues: Issue[] = [];
let size = 0;
for (const i of found) {
  if (issues.length && size + i.text.length > maxChars) break;
  issues.push(i);
  size += i.text.length;
}
const deferred = found.length - issues.length;

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const sections = issues.map((i) => `## ${i.feed}: ${i.title} (${i.date.toISOString().slice(0, 10)})\n\n${i.url}\n\n${i.text}`);
const header = `# Newsletter issues not yet covered by a previous digest (fetched ${stamp} UTC)\n\n${issues.length ? `${issues.length} new issues.` : "No new issues since the last digest."}`;
await writeFile("newsletters.md", [header, ...sections].join("\n\n") + "\n");
await writeFile("newsletters.json", JSON.stringify(issues.map((i) => i.url)));
console.log(`newsletters.md: ${issues.length} new issues from ${feeds.length} feeds, ${deferred} deferred to next run, ${failed.length} failed`);
for (const f of failed) console.log(`  failed ${f}`);
