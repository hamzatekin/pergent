import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listRuns, listTasks, runTask } from "./runner.ts";

const [command, name] = process.argv.slice(2);

if (command === "list") {
  console.log((await listTasks()).join("\n"));
} else if (command === "run" && name) {
  console.log(`running ${name}...`);
  const { meta, dir } = await runTask(name);
  console.log(await readFile(join(dir, "output.md"), "utf8"));
  console.log(`\n${meta.status} · ${meta.turns ?? "?"} turns · $${meta.costUsd?.toFixed(2) ?? "?"} · ${dir}`);
  process.exit(meta.status === "ok" ? 0 : 1);
} else if (command === "costs") {
  // Cost per run, newest first, to see what a prompt or input change did to spend.
  for (const task of name ? [name] : await listTasks()) {
    const runs = listRuns(task).slice(0, 20);
    const costs = runs.flatMap((r) => r.costUsd ?? []);
    const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    console.log(`\n${task} · last ${runs.length} runs · avg $${avg.toFixed(2)}`);
    for (const r of runs) {
      const mins = r.finishedAt ? ((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 60000).toFixed(1) : "?";
      console.log(`  ${r.runId}  ${r.status.padEnd(7)} ${String(r.turns ?? "?").padStart(3)} turns  ${mins.padStart(5)} min  $${r.costUsd?.toFixed(2) ?? "?"}`);
    }
  }
} else {
  console.log("usage: node src/cli.ts list | run <task> | costs [task]");
  process.exit(1);
}
