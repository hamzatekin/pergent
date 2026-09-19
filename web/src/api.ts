export type RunMeta = {
  task: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "failed";
  costUsd?: number;
  turns?: number;
};
export type Run = { meta: RunMeta; output: string; images: Record<string, string> };

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  tasks: () => request<string[]>("/tasks"),
  runs: (name: string) => request<RunMeta[]>(`/tasks/${name}/runs`),
  run: (name: string, runId: string) => request<Run>(`/tasks/${name}/runs/${runId}`),
};
