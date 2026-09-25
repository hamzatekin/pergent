import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Paper } from "./paper.ts";

// Lead images for stories whose source is an article, not a post: the page's og:image (or
// twitter:image), the picture a site sets for link previews. The before scripts already put post
// photos and Bundle images in images.json; this fills in the rest (HN and newsletter links in tech,
// article links in news) after the paper is written. Plain HTTP, no model. A page that fails, is slow
// or has no preview image is skipped; what was found is merged into images.json, which the reading
// view looks up by source URL.

const CONCURRENCY = 8;
const MAX_STORIES = 80;
const MAX_BYTES = 512 * 1024; // the <head> is near the top; the rest of the page is not needed
// Sources with no useful preview image of their own (X photos come from fetch-x.ts).
const SKIP = /^(x\.com|twitter\.com|news\.ycombinator\.com)$/;

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function head(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; pergent; +link preview)", accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("html")) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return html;
}

// The first og:image or twitter:image meta tag, attributes in either order, resolved against the page.
function previewImage(html: string, page: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
    if (key !== "og:image" && key !== "og:image:url" && key !== "og:image:secure_url" && key !== "twitter:image") continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    try {
      const url = new URL(content.replace(/&amp;/g, "&"), page);
      if (url.protocol === "https:") return url.toString(); // the page's CSP allows https images only
    } catch {}
  }
}

export async function addPreviewImages(paper: Paper, dir: string): Promise<void> {
  const file = join(dir, "images.json");
  const images: Record<string, string> = await readFile(file, "utf8").then(JSON.parse, () => ({}));
  const sources = [...new Set(paper.sections.flatMap((s) => s.stories.map((st) => st.source ?? "")))]
    .filter((src) => /^https?:\/\//.test(src) && !images[src] && !SKIP.test(host(src)))
    .slice(0, MAX_STORIES);
  let next = 0;
  let found = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < sources.length) {
        const src = sources[next++];
        const image = await head(src).then((html) => previewImage(html, src), () => undefined);
        if (image) {
          images[src] = image;
          found++;
        }
      }
    }),
  );
  if (found) await writeFile(file, JSON.stringify(images));
  await writeFile(join(dir, "images.log"), `preview images: ${found} of ${sources.length} article sources\n`);
}
