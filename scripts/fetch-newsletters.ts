// Pulls new issues from newsletter RSS feeds into newsletters.md in the current directory.
// An issue is delivered once: the issue URLs of each run are saved to newsletters.json, and the sibling
// run directories (../*/newsletters.json) are scanned to skip issues already delivered. A missed day is
// caught up on the next run without repeats. Every new issue, deferred ones too, also goes to
// issues.json as cleaned HTML, which the runner saves to the database for the Newsletters page: the
// issues as they were published, without the model. Config from $TASK_DIR/task.json under "newsletters":
//   feeds     [{ name, url }]   RSS 2.0 feeds; the issue body is taken from content:encoded or description
//             [{ name, sitemap, match?, content? }]  a newsletter with no feed (NativeWeekly, beehiiv
//             without RSS): its sitemap's URLs containing `match` (default "/p/") are the issues, and
//             each page's element with id `content` (default "content-blocks", beehiiv's) is the body
//   days      lookback window for a never-seen issue (default 7)
//   maxChars  size cap for newsletters.md (default 60000); claude's Read truncates big files, so older
//             issues past the cap are left for the next run instead of being silently cut
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
type Feed = { name: string; url?: string; sitemap?: string; match?: string; content?: string };
const feeds: Feed[] = config.newsletters?.feeds ?? [];
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
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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

// utm_ parameters are noise to the model and long in tokens (The Deep View tags every link with three).
function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

// The issue as published, for reading it whole: only plain tags, no attributes but a link's href and an
// image's src and alt, so nothing of the newsletter's own styling, scripts or tracking pixels survives
// (the site's CSP would block inline styles anyway). Layout tables and their cells become divs.
const KEEP = new Set(["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "a", "strong", "b", "em", "i", "sub", "sup", "img", "figure", "figcaption"]);
const AS_DIV = new Set(["div", "table", "tbody", "thead", "tfoot", "tr", "td", "th", "section", "article", "center", "header", "footer", "main"]);
const attr = (attrs: string, name: string) => unescape(attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((v) => v !== undefined) ?? "");
const quote = (v: string) => `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;

async function cleanHtml(html: string): Promise<string> {
  const links: Promise<string>[] = [];
  let out = html
    .replace(/<(script|style|head|title|svg|noscript|template|iframe|form|button|select|textarea)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_, close: string, tagName: string, attrs: string) => {
      const name = tagName.toLowerCase();
      if (AS_DIV.has(name)) return `<${close}div>`;
      if (!KEEP.has(name)) return "";
      if (close) return name === "br" || name === "hr" || name === "img" ? "" : `</${name}>`;
      if (name === "a") {
        const href = attr(attrs, "href");
        if (!/^(https?:|mailto:)/i.test(href)) return "<a>";
        links.push(resolveLink(href));
        return `<a href="\u0000${links.length - 1}\u0000">`;
      }
      if (name === "img") {
        const src = attr(attrs, "src");
        const size = Math.min(Number(attr(attrs, "width")) || 99, Number(attr(attrs, "height")) || 99);
        return src.startsWith("https://") && size > 2 ? `<img src=${quote(src)} alt=${quote(attr(attrs, "alt"))}>` : "";
      }
      return `<${name}>`;
    });
  const urls = (await Promise.all(links)).map(stripTracking);
  out = out.replace(/"\u0000(\d+)\u0000"/g, (_, i) => quote(urls[Number(i)]));
  // Emptied wrappers (spacer cells, a div that only held a pixel) go, inside out.
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/<(div|p|a|strong|b|em|i|li|h[1-6])>(?:\s|&nbsp;|&#160;|<br>)*<\/\1>/g, "");
  }
  return out.replace(/\s*\n\s*/g, "\n").trim();
}

// The element whose opening tag starts at `start`, with everything inside it, found by counting the
// opening and closing tags of its kind.
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr", "area", "col"]);
function elementAt(html: string, start: number): string {
  const name = html.slice(start + 1).match(/^[a-zA-Z]+/)![0];
  if (VOID.has(name.toLowerCase())) return html.slice(start, html.indexOf(">", start) + 1);
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    if (!m[0].endsWith("/>")) depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

// The element with this id (a beehiiv post page is ~700KB, the issue itself a small part of it).
function element(html: string, id: string): string {
  const start = html.search(new RegExp(`<[a-z]+[^>]*\\sid="${id}"`));
  return start < 0 ? "" : elementAt(html, start);
}

// Emails hide a preview line and tracking markers with display:none; they are not part of the issue.
function withoutHidden(html: string): string {
  const hidden = /<[a-zA-Z]+\b[^>]*style="[^"]*display:\s*none[^>]*>/gi;
  for (let m; (m = hidden.exec(html)); ) {
    html = html.slice(0, m.index) + html.slice(m.index + elementAt(html, m.index).length);
    hidden.lastIndex = m.index;
  }
  return html;
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
  const urls = (await Promise.all(links)).map(stripTracking);
  return unescape(text)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)])
    .replace(/[ \t​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Issue = { feed: string; title: string; url: string; date: Date; text: string; html: string };

const get = async (url: string) => {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
};
const meta = (html: string, property: string) => unescape(html.match(new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`))?.[1] ?? "").trim();

async function issue(feed: string, title: string, url: string, date: Date, html: string): Promise<Issue> {
  const body = withoutHidden(html.replace(/<!--[\s\S]*?-->/g, ""));
  return { feed, title, url, date, text: await htmlToText(body), html: await cleanHtml(body) };
}

async function fromFeed(feed: Feed): Promise<Issue[]> {
  const xml = await get(feed.url!);
  const issues: Issue[] = [];
  for (const item of xml.split(/<item[\s>]/).slice(1)) {
    const url = tag(item, "link") || tag(item, "guid");
    const date = new Date(tag(item, "pubDate"));
    if (!url || seen.has(url) || Number.isNaN(date.getTime()) || date.getTime() < since) continue;
    issues.push(await issue(feed.name, tag(item, "title"), url, date, tag(item, "content:encoded") || tag(item, "description")));
  }
  return issues;
}

// A sitemap's <lastmod> is a day, so an entry counts from the end of that day; the page's own
// publication time decides.
async function fromSitemap(feed: Feed): Promise<Issue[]> {
  const xml = await get(feed.sitemap!);
  const issues: Issue[] = [];
  for (const [, loc, lastmod] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>\s*(?:<lastmod>\s*([^<\s]+)\s*<\/lastmod>)?/g)) {
    const url = unescape(loc);
    if (!url.includes(feed.match ?? "/p/") || seen.has(url)) continue;
    if (lastmod && Date.parse(lastmod) + 86_400_000 < since) continue;
    const page = await get(url);
    const date = new Date(meta(page, "article:published_time") || lastmod);
    const body = element(page, feed.content ?? "content-blocks");
    if (Number.isNaN(date.getTime()) || date.getTime() < since || !body) continue;
    issues.push(await issue(feed.name, meta(page, "og:title") || url, url, date, body));
  }
  return issues;
}

const found: Issue[] = [];
const failed: string[] = [];
await Promise.all(
  feeds.map(async (feed) => {
    try {
      found.push(...(await (feed.sitemap ? fromSitemap(feed) : fromFeed(feed))));
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
  i.text = withoutIssueLinks(i);
  if (issues.length && size + i.text.length > maxChars) break;
  issues.push(i);
  size += i.text.length;
}
const deferred = found.length - issues.length;

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
// The issue's own URL is left out of the text (the bare line under the heading, "Read on the Web
// (<issue>)"): given an easy link to copy, the model sourced every newsletter story to the issue
// instead of the article. Each item's link sits in parentheses after its title.
function withoutIssueLinks(i: Issue): string {
  const issue = stripTracking(i.url).replace(/\/$/, "");
  return i.text
    .split("\n")
    .map((line) => line.replace(/ \((https?:\/\/[^)\s]+)\)/g, (m, url: string) => (url.replace(/\/$/, "") === issue ? "" : m)))
    .filter((line) => !/^\s*Read on the Web\s*$/i.test(line))
    .join("\n");
}
const sections = issues.map((i) => `## ${i.feed}: ${i.title} (${i.date.toISOString().slice(0, 10)})\n\n${i.text}`);
const header = `# Newsletter issues not yet covered by a previous digest (fetched ${stamp} UTC)\n\n${issues.length ? `${issues.length} new issues. Each item's link is in parentheses after its title; that is the story's source.` : "No new issues since the last digest."}`;
await writeFile("newsletters.md", [header, ...sections].join("\n\n") + "\n");
await writeFile("newsletters.json", JSON.stringify(issues.map((i) => i.url)));
await writeFile("issues.json", JSON.stringify(found.map((i) => ({ feed: i.feed, title: i.title, url: stripTracking(i.url), date: i.date.toISOString(), html: i.html }))));
console.log(`newsletters.md: ${issues.length} new issues from ${feeds.length} feeds, ${deferred} deferred to next run, ${failed.length} failed`);
for (const f of failed) console.log(`  failed ${f}`);
