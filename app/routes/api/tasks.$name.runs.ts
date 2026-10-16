import { createFileRoute } from "@tanstack/react-router";
import { listRuns } from "#src/runner.ts";
import { canRead } from "../../server/admin.ts";

export const Route = createFileRoute("/api/tasks/$name/runs")({
  server: {
    handlers: {
      GET: async ({ params }) => ((await canRead(params.name)) ? Response.json(listRuns(params.name)) : Response.json({ error: "not found" }, { status: 404 })),
    },
  },
});
