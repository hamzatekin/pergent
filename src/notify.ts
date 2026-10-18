import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Paper } from "./paper.ts";

// A push to the reader's phone through ntfy (ntfy.sh, or the server in NTFY_URL) when a finished paper
// has stories that matter enough: those of importance `importance` or more in the sections whose heading
// contains `section`. The settlement task uses it to say only when final rules or a firm date are
// published; a quiet day sends nothing. The topic name is the only secret (anyone who knows it can
// read and post), so it lives in NTFY_TOPIC, not in task.json; without it nothing is sent. With
// PUBLIC_URL set the notification opens the paper, otherwise the first story's source. One message per
// run, its result in notify.log; a failed push never fails the run.
export type NotifyRule = { section?: string; importance?: number };

const plain = (md: string) =>
  md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function notifyPaper(task: string, runId: string, paper: Paper, rule: NotifyRule, dir: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  const min = rule.importance ?? 3;
  const section = (rule.section ?? "").toLowerCase();
  const stories = paper.sections
    .filter((s) => (s.heading ?? "").toLowerCase().includes(section))
    .flatMap((s) => s.stories)
    .filter((s) => (s.importance ?? 2) >= min);
  if (!stories.length) return writeFile(join(dir, "notify.log"), "nothing to send\n");
  if (!topic) return writeFile(join(dir, "notify.log"), `${stories.length} stories to send, but NTFY_TOPIC is not set\n`);

  const [first, ...rest] = stories;
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  const click = base ? `${base}/read/${encodeURIComponent(task)}/${encodeURIComponent(runId)}` : first.source;
  let message = plain(first.body);
  if (message.length > 600) message = `${message.slice(0, 600)}…`;
  if (rest.length) message += `\n\nAlso: ${rest.map((s) => s.headline).join("; ")}`;
  const res = await fetch(process.env.NTFY_URL ?? "https://ntfy.sh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, title: first.headline, message, click, priority: 4, tags: ["rotating_light"] }),
    signal: AbortSignal.timeout(15_000),
  });
  await writeFile(join(dir, "notify.log"), `sent ${stories.length} stories: ${res.status} ${await res.text()}\n`);
}
