// Drops clickbait, filler and praise from the fetched news inputs before the model reads them, using
// Jev (TypeSafe's System One model, https://docs.typesafe.ai): one Choice question per item, 20 items
// to a request, asked about the item's text. What it drops never reaches the prompt, so the model has
// less to read and less to throw away. Items are rewritten in place in the files; everything dropped
// is listed in filter.log with its kind and probability, so the filter's judgement can be checked.
// Jev reads Turkish less well than English, so an item is dropped only when Jev is sure (see
// `threshold`), and any request that fails keeps its items. Without TYPESAFE_API_KEY nothing is
// filtered. Config from $TASK_DIR/task.json under "filter":
//   files      the input files to filter, in the fetch scripts' "- " item format
//   threshold  how sure Jev must be of a drop kind to drop the item (default 0.8)
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const files: string[] = config.filter?.files ?? [];
const threshold: number = config.filter?.threshold ?? 0.8;
const apiKey = process.env.TYPESAFE_API_KEY;
const BATCH = 20;
const CONCURRENCY = 6;

// The kinds Jev picks from. Only DROP kinds are removed; opinion stays, since the prompt already
// tells the model to take a journalist's news and leave their comment.
const KINDS: Record<string, string> = {
  event:
    "Reports something specific that happened or was announced: a decision, statement, arrest, court ruling, appointment, figure, match result, accident, disaster.",
  opinion: "Commentary, analysis or a personal view about the news, with no new fact of its own.",
  clickbait:
    "Hides the fact to make you click: 'şok', 'bakın ne oldu', 'o isim', 'herkes bunu konuşuyor', 'ortalık karıştı', a teaser without saying what happened.",
  filler:
    "Service or lifestyle filler, not news: horoscopes, weather, traffic, exam or salary calculation guides, how-to guides, lists and rankings, deals, ads, promotion of the outlet's own programmes.",
  praise:
    "Praise or propaganda: celebrates a politician or the government ('müjde', thanks, slogans, 'tarihi başarı') without a new concrete fact.",
};
const DROP = new Set(["clickbait", "filler", "praise"]);

type Item = { file: string; start: number; end: number; text: string };
type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number> };

// An item is a line starting with "- " plus its indented continuation lines (a post's text and URL).
function parse(file: string, lines: string[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("- ")) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].startsWith("  ")) end++;
    items.push({ file, start: i, end, text: lines.slice(i, end).join("\n").trim() });
    i = end - 1;
  }
  return items;
}

async function classify(batch: Item[]): Promise<(ChoiceAnswer | undefined)[]> {
  const questions = Object.fromEntries(
    batch.map((_, i) => [
      `p${i}`,
      { type: "choice", instructions: `What kind of Turkish news post is \`posts[${i}]\`? Judge the post's own text.`, criteria: KINDS },
    ]),
  );
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: { posts: batch.map((b) => b.text) }, questions }),
      signal: AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 529) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { answers: Record<string, ChoiceAnswer> };
    return batch.map((_, i) => body.answers[`p${i}`]);
  }
}

if (!apiKey) {
  console.log("filter: no TYPESAFE_API_KEY, nothing filtered");
  process.exit(0);
}

const texts = new Map<string, string[]>();
const items: Item[] = [];
for (const f of files) {
  const lines = await readFile(f, "utf8").then((t) => t.split("\n"), () => null);
  if (!lines) continue;
  texts.set(f, lines);
  items.push(...parse(f, lines));
}

const batches: Item[][] = [];
for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
const dropped: { item: Item; kind: string; p: number }[] = [];
const failures: string[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const answers = await classify(batch);
        batch.forEach((item, i) => {
          const a = answers[i];
          const p = a?.probabilities?.[a.choice] ?? 0;
          if (a && DROP.has(a.choice) && p >= threshold) dropped.push({ item, kind: a.choice, p });
        });
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
  }),
);

// Rewrite each file without its dropped items, and the blank line after each, if there is one.
const gone = new Set(dropped.map((d) => d.item));
for (const [f, lines] of texts) {
  const cut = new Set<number>();
  for (const item of items) {
    if (item.file !== f || !gone.has(item)) continue;
    for (let i = item.start; i < item.end; i++) cut.add(i);
    if (lines[item.end]?.trim() === "") cut.add(item.end);
  }
  if (cut.size) await writeFile(f, lines.filter((_, i) => !cut.has(i)).join("\n"));
}

const byKind = [...DROP].map((k) => `${dropped.filter((d) => d.kind === k).length} ${k}`).join(", ");
const log = [
  `jev-latest: ${items.length} items in ${batches.length} requests, dropped ${dropped.length} (${byKind}) at p >= ${threshold}, ${failures.length} requests failed`,
  ...failures.map((f) => `failed: ${f}`),
  ...dropped.map((d) => `${d.kind} ${d.p.toFixed(2)} ${d.item.file}: ${d.item.text.replace(/\s+/g, " ").slice(0, 300)}`),
];
await writeFile("filter.log", log.join("\n") + "\n");
console.log(`filter: ${log[0]}`);
