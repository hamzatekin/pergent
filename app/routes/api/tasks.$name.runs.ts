import { createFileRoute } from "@tanstack/react-router";
import { listRuns } from "#src/runner.ts";

export const Route = createFileRoute("/api/tasks/$name/runs")({
  server: { handlers: { GET: ({ params }) => Response.json(listRuns(params.name)) } },
});
