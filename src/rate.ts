import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Paper, Rating, Story } from "./paper.ts";

// Rates every story of a finished paper with Jev (TypeSafe's System One model: typed questions in,
// calibrated scores out, https://docs.typesafe.ai). Each story is one request whose state is the story
// as written plus the input it came from: the block of the fetched files (tweets, posts, HN, newsletter,
// Bundle) that carries its source URL, with the account group and handle above it. Three Score
// questions, combined in code with fixed weights into one 0-10 number, since Jev is calibrated on
// judgments and not on arithmetic. Only when TYPESAFE_API_KEY is set and the task does not say
// `"rate": false`; a failed request leaves that story unrated and never fails the run. rate.log in the
// run directory has every answer and error.

const URL_ = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const CONCURRENCY = 8;
const EXCERPT_CHARS = 2500;
// Files in the run directory that are not input: the prompt, what claude wrote, and the memory.
const NOT_INPUT = new Set(["prompt.md", "output.md", "previous.md"]);

type Question = { type: "score"; instructions: string | object; criteria: string[] };

// What each part asks, and how much it weighs in the overall number.
const QUESTIONS: Record<string, Question & { weight: number }> = {
  sourcing: {
    type: "score",
    weight: 0.45,
    instructions: "How well is the main claim of `story` backed by `source_material`? Judge who is saying it and on what basis, not whether you agree.",
    criteria: [
      "No source material, or an anonymous rumour, unverified claim or gossip",
      "One account's claim or opinion, not backed by a named outlet, a document or first-hand knowledge",
      "Reported by a named news outlet or journalist, or a company or project announcing its own news",
      "A primary source (official statement, court ruling, document, release notes, paper, data) or reported by several independent outlets",
    ],
  },
  neutrality: {
    type: "score",
    weight: 0.25,
    instructions: "How plain and non-sensational is `source_material`? Judge the tone and framing of the original, not of `story`.",
    criteria: [
      "Clickbait, propaganda or marketing hype",
      "Noticeably spun, one-sided or promotional",
      "Mostly factual with some framing",
      "Plain and factual",
    ],
  },
  substance: {
    type: "score",
    weight: 0.3,
    instructions: "How much does `story` give a reader to take away?",
    criteria: [
      "Nothing concrete: vague, filler or gossip",
      "One concrete fact with little detail",
      "Concrete facts with some detail, numbers or consequences",
      "Specific facts, numbers or technical detail, and why it matters",
    ],
  },
};

type ScoreAnswer = { type: "score"; score: number; confidence: number };
type Response = { model: string; answers: Record<string, ScoreAnswer>; usage?: { input_tokens: number } };

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
  const questions = Object.fromEntries(Object.entries(QUESTIONS).map(([id, { weight: _, ...q }]) => [id, q]));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions }),
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

// Each part on 0-10 from its level (score / top level), the overall number their weighted mean.
function toRating(answers: Record<string, ScoreAnswer>): Rating {
  const parts: Record<string, number> = {};
  let total = 0;
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const a = answers[id];
    if (typeof a?.score !== "number") throw new Error(`no answer for ${id}`);
    parts[id] = Math.round((a.score / (q.criteria.length - 1)) * 100) / 10;
    total += parts[id] * q.weight;
  }
  return { score: Math.round(total * 10) / 10, parts };
}

export async function ratePaper(paper: Paper, dir: string, apiKey: string): Promise<void> {
  const files = await inputs(dir).catch(() => []);
  const stories: { story: Story; section: string }[] = paper.sections.flatMap((s) => s.stories.map((story) => ({ story, section: s.heading ?? "" })));
  const log: string[] = [];
  let tokens = 0;
  let next = 0;
  const worker = async () => {
    while (next < stories.length) {
      const { story, section } = stories[next++];
      const state = {
        story: { section, headline: story.headline, body: story.body, context: story.context, source: story.source },
        source_material: story.source ? excerpt(files, story.source) || "(not found in the input files)" : "(no source)",
      };
      try {
        const res = await ask(state, apiKey);
        story.rating = toRating(res.answers);
        tokens += res.usage?.input_tokens ?? 0;
        log.push(`${story.rating.score} ${JSON.stringify(story.rating.parts)} ${story.headline}`);
      } catch (err) {
        log.push(`failed: ${err instanceof Error ? err.message : String(err)} ${story.headline}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rated = stories.filter((s) => s.story.rating).length;
  log.unshift(`${MODEL}: rated ${rated} of ${stories.length} stories, ${tokens} input tokens`);
  await writeFile(join(dir, "rate.log"), log.join("\n") + "\n");
}
