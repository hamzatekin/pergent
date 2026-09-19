import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { ReadView } from "./Read.tsx";
import { usePath } from "./router.tsx";

// The site is only the reading view: `/` and `/read` show the first task's latest run,
// `/read/<task>[/<runId>]` a specific task or run. Prompts and configs are edited in git.
export function App() {
  const [tasks, setTasks] = useState<string[]>([]);
  const path = usePath();

  useEffect(() => {
    api.tasks().then(setTasks);
  }, []);

  const match = path.match(/^(?:\/read)?(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
  const task = match?.[1] ?? tasks[0];
  return task ? <ReadView key={task} tasks={tasks} task={task} runId={match?.[2]} /> : null;
}
