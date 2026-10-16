// Writes briefings.md in the current directory, for the today task: the newest ok paper of every other
// task (the briefings behind Today), each with its link on the site, a rough count of what it read and
// what it kept, and its sections' leads and headlines, so Today can say in one line what each tab holds
// and spot a story that connects to the reader's notes. Reads the sibling tasks' run directories
// (../../<task>/*/meta.json and output.json); private tasks are left out. "Read" is the items in the
// task's input files (lines starting `- ` or `### `, which is how the before scripts list posts,
// articles and pages) plus what the Jev filter dropped (filter.log's first line); memory files
// (previous.md, last.md, muted.md) do not count.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type Story = { headline: string; body: string; importance?: number };
type Paper = { title?: string; sections: { heading?: string; lead?: string; stories: Story[] }[] };

const MEMORY = new Set(["previous.md", "last.md", "muted.md"]);
const tasksDir = resolve(process.env.TASK_DIR!, "..");
const runsRoot = resolve("../..");
const self = basename(process.env.TASK_DIR!);
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => (flat(s).length > max ? `${flat(s).slice(0, max)}…` : flat(s));

// The tabs in the sidebar's order: `order`, then name.
const tasks: { task: string; config: any }[] = [];
for (const task of (await readdir(tasksDir)).sort()) {
  const config = await readFile(join(tasksDir, task, "task.json"), "utf8").then(JSON.parse, () => null);
  if (task !== self && config && !config.private) tasks.push({ task, config });
}
tasks.sort((a, b) => Number(a.config.order ?? 0) - Number(b.config.order ?? 0));

let out = `# The briefings: the newest paper of each tab\n\nLinks are paths on this site.\n`;
let count = 0;
for (const { task, config } of tasks) {
  const runs: { runId: string; startedAt: string }[] = [];
  for (const runId of await readdir(join(runsRoot, task)).catch(() => [] as string[])) {
    const meta = await readFile(join(runsRoot, task, runId, "meta.json"), "utf8").then(JSON.parse, () => null);
    if (meta?.status === "ok") runs.push({ runId, startedAt: meta.startedAt });
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const label = config.label ?? task;
  const latest = runs[0];
  const paper: Paper | null = latest ? await readFile(join(runsRoot, task, latest.runId, "output.json"), "utf8").then(JSON.parse, () => null) : null;
  if (!latest || !paper) {
    out += `\n## ${label}\n\nNo paper yet.\n`;
    continue;
  }
  const dir = join(runsRoot, task, latest.runId);
  let items = 0;
  for (const f of (config.inputs ?? []) as string[]) {
    if (MEMORY.has(f)) continue;
    const text = await readFile(join(dir, f), "utf8").catch(() => "");
    items += text.split("\n").filter((l) => /^(- |### )/.test(l)).length;
  }
  const filter = await readFile(join(dir, "filter.log"), "utf8").catch(() => "");
  const dropped = Number(filter.match(/dropped (\d+)/)?.[1] ?? 0);
  const stories = paper.sections.flatMap((s) => s.stories);
  const big = stories.filter((s) => (s.importance ?? 2) > 1).length;
  const hours = Math.round((Date.now() - Date.parse(latest.startedAt)) / 3_600_000);

  out += `\n## ${label}: ${paper.title ?? ""}\n\n`;
  out += `Link: /read/${task}/${latest.runId}\n`;
  out += `Written ${hours} hours ago (${latest.startedAt.slice(0, 16).replace("T", " ")} UTC).\n`;
  out += `Read about ${items + dropped} items${dropped ? ` (the filter dropped ${dropped} as clickbait, filler or promotion before the model saw them)` : ""}; the paper has ${stories.length} stories, ${big} of them full stories and ${stories.length - big} briefs.\n`;
  for (const section of paper.sections) {
    out += `\n### ${section.heading ?? ""}\n`;
    if (section.lead) out += `${clip(section.lead, 500)}\n`;
    for (const s of section.stories) out += `- ${s.importance === 3 ? "[lead] " : s.importance === 1 ? "[brief] " : ""}${clip(s.headline, 160)}${s.importance === 3 ? ` — ${clip(s.body, 240)}` : ""}\n`;
  }
  count++;
}

await writeFile("briefings.md", out);
console.log(`briefings: ${count} papers, ${out.length} chars`);
