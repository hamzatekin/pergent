export type TaskConfig = { schedule?: string; model?: string; allowedTools?: string[]; timeoutMinutes?: number };
export type Task = { name: string; config: TaskConfig; prompt: string };
export type RunMeta = {
  task: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "failed";
  costUsd?: number;
  turns?: number;
};
export type Run = { meta: RunMeta; output: string; log: string; stderr: string; before: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  tasks: () => request<Task[]>("/tasks"),
  saveTask: (name: string, task: Pick<Task, "config" | "prompt">) =>
    request<Task>(`/tasks/${name}`, { method: "PUT", body: JSON.stringify(task) }),
  runs: (name: string) => request<RunMeta[]>(`/tasks/${name}/runs`),
  run: (name: string, runId: string) => request<Run>(`/tasks/${name}/runs/${runId}`),
  start: (name: string) => request<{ started: true }>(`/tasks/${name}/run`, { method: "POST" }),
};
