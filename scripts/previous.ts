// Writes previous.md in the current directory: the stories of the task's recent papers, so the model can
// leave out what the reader has already seen. Reads the sibling run directories (../*/meta.json and
// output.json) of ok runs that started in the last N days, newest first; runs from before structured
// output have no output.json and are skipped. Config from $TASK_DIR/task.json under "previous":
//   days      how far back to look (default 3)
//   maxChars  size cap for previous.md (default 30000); older papers past the cap are dropped, since
//             claude's Read truncates big files
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type Story = { headline: string; source?: string };
type Paper = { title?: string; sections: { heading?: string; stories: Story[] }[] };

const config = JSON.parse(await readFile(join(process.env.TASK_DIR!, "task.json"), "utf8"));
const days: number = config.previous?.days ?? 3;
const maxChars: number = config.previous?.maxChars ?? 30_000;
const since = Date.now() - days * 86_400_000;

const runsDir = resolve("..");
const self = basename(resolve("."));
const papers: { startedAt: string; paper: Paper }[] = [];
for (const dir of await readdir(runsDir).catch(() => [] as string[])) {
  if (dir === self) continue;
  try {
    const meta = JSON.parse(await readFile(join(runsDir, dir, "meta.json"), "utf8"));
    if (meta.status !== "ok" || Date.parse(meta.startedAt) < since) continue;
    papers.push({ startedAt: meta.startedAt, paper: JSON.parse(await readFile(join(runsDir, dir, "output.json"), "utf8")) });
  } catch {}
}
papers.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

let out = "";
let kept = 0;
let stories = 0;
for (const { startedAt, paper } of papers) {
  let block = `# ${paper.title ?? startedAt.slice(0, 10)} (${startedAt.slice(0, 10)})\n`;
  let count = 0;
  for (const section of paper.sections ?? []) {
    if (!section.stories?.length) continue;
    block += `\n## ${section.heading ?? ""}\n`;
    for (const s of section.stories) {
      block += `- ${s.headline}${s.source ? ` ${s.source}` : ""}\n`;
      count++;
    }
  }
  if (out.length + block.length + 1 > maxChars) break;
  out += `${block}\n`;
  kept++;
  stories += count;
}

await writeFile("previous.md", out || `No papers in the last ${days} days.\n`);
console.log(`previous: ${kept} of ${papers.length} papers from the last ${days} days, ${stories} stories, ${out.length} chars`);
