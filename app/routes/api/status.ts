import { createFileRoute } from "@tanstack/react-router";
import { schedulerStatus } from "#src/scheduler.ts";

export const Route = createFileRoute("/api/status")({
  server: { handlers: { GET: () => Response.json(schedulerStatus()) } },
});
