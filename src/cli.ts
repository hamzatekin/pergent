import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listTasks, runTask } from "./runner.ts";

const [command, name] = process.argv.slice(2);

if (command === "list") {
  console.log((await listTasks()).join("\n"));
} else if (command === "run" && name) {
  console.log(`running ${name}...`);
  const { meta, dir } = await runTask(name);
  console.log(await readFile(join(dir, "output.md"), "utf8"));
  console.log(`\n${meta.status} · ${meta.turns ?? "?"} turns · $${meta.costUsd?.toFixed(2) ?? "?"} · ${dir}`);
  process.exit(meta.status === "ok" ? 0 : 1);
} else {
  console.log("usage: node src/cli.ts list | run <task>");
  process.exit(1);
}
