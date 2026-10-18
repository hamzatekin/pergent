import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Paper, Story } from "./paper.ts";

// Scores every story of a finished paper by how much it matters to the reader, with Jev (TypeSafe's
// System One model: typed questions in, calibrated scores out, https://docs.typesafe.ai). The reader is
// the task's `reader` in task.json, a few sentences on who reads the tab and what they care about.
// Each story is one request whose state is the reader, the story as written and the input it came
// from: the block of the fetched files (tweets, posts, HN, newsletter, Bundle) that carries its source
// URL, with the account group and handle above it. The answer is `story.forYou`, 0-3, which the page
// uses to order each section and to move stories that are not for the reader into the briefs
// (app/server/paper-view.ts). Only when TYPESAFE_API_KEY is set and the task has a `reader`; a failed
// request leaves that story unscored and never fails the run. rate.log in the run directory has every
// answer and error.

const URL_ = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const CONCURRENCY = 8;
const EXCERPT_CHARS = 2500;
// Files in the run directory that are not input: the prompt, what claude wrote, and the memory.
const NOT_INPUT = new Set(["prompt.md", "output.md", "previous.md"]);

const QUESTION = {
  type: "score",
  instructions:
    "How much does `story` matter to `reader`? Judge by what the reader works on, uses and follows, not by how big the news is in general. `source_material` is the original the story was written from.",
  criteria: [
    "Not for them: about something they do not work on, use or follow",
    "Loosely related: background on a topic near theirs, fine to skip",
    "Relevant: about something they work on, use or follow, worth reading",
    "Directly useful to them or affects them: something they would act on, try or need to know today",
  ],
};

type ScoreAnswer = { type: "score"; score: number; confidence: number };
type Response = { model: string; answers: { for_you?: ScoreAnswer }; usage?: { input_tokens: number } };

// The input files, read once per paper.
async function inputs(dir: string): Promise<string[][]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".md") && !NOT_INPUT.has(f));
  return Promise.all(names.map(async (f) => (await readFile(join(dir, f), "utf8")).split("\n")));
}

// The block around the first line carrying the URL: up to the item's own "- " line or a blank line,
// down to the next item, heading or blank line, plus the nearest "## " and "### " headings above
// (the account group and handle in the tweet files).
function excerpt(files: string[][], url: string): string {
  const bare = url.replace(/[?#].*$/, "");
  for (const lines of files) {
    const at = lines.findIndex((l) => l.includes(url));
    const i = at >= 0 ? at : lines.findIndex((l) => bare.length > 12 && l.includes(bare));
    if (i < 0) continue;
    let start = i;
    while (start > 0 && !/^(- |#)/.test(lines[start]) && lines[start - 1].trim() !== "" && !/^#/.test(lines[start - 1])) start--;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== "" && !/^(- |#)/.test(lines[end])) end++;
    const heads: string[] = [];
    for (let j = start - 1, need = new Set(["##", "###"]); j >= 0 && need.size; j--) {
      const h = lines[j].match(/^(#{2,3}) /)?.[1];
      if (h && need.has(h)) {
        heads.unshift(lines[j]);
        need.delete(h);
        if (h === "##") break;
      }
    }
    return [...heads, ...lines.slice(start, end)].join("\n").slice(0, EXCERPT_CHARS);
  }
  return "";
}

async function ask(state: object, apiKey: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions: { for_you: QUESTION } }),
      signal: AbortSignal.timeout(30_000),
    });
    // 429 rate limited, 529 overloaded: back off and try again, twice.
    if ((res.status === 429 || res.status === 529) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as Response;
  }
}

export async function ratePaper(paper: Paper, dir: string, apiKey: string, reader: string): Promise<void> {
  const files = await inputs(dir).catch(() => []);
  const stories: { story: Story; section: string }[] = paper.sections.flatMap((s) => s.stories.map((story) => ({ story, section: s.heading ?? "" })));
  const log: string[] = [];
  let tokens = 0;
  let next = 0;
  const worker = async () => {
    while (next < stories.length) {
      const { story, section } = stories[next++];
      const state = {
        reader,
        story: { section, headline: story.headline, body: story.body, context: story.context, source: story.source },
        source_material: story.source ? excerpt(files, story.source) || "(not found in the input files)" : "(no source)",
      };
      try {
        const res = await ask(state, apiKey);
        const score = res.answers.for_you?.score;
        if (typeof score !== "number") throw new Error("no answer");
        // Jev's score is the expected level, so 2.8 is "directly useful" with a little doubt.
        story.forYou = Math.round(score * 100) / 100;
        tokens += res.usage?.input_tokens ?? 0;
        log.push(`${story.forYou} ${story.headline}`);
      } catch (err) {
        log.push(`failed: ${err instanceof Error ? err.message : String(err)} ${story.headline}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rated = stories.filter((s) => s.story.forYou !== undefined).length;
  log.unshift(`${MODEL}: scored ${rated} of ${stories.length} stories for the reader, ${tokens} input tokens`);
  await writeFile(join(dir, "rate.log"), log.join("\n") + "\n");
}
