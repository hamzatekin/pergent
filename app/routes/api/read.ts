import { createFileRoute } from "@tanstack/react-router";
import { markRead } from "#src/scheduler.ts";

// What the reading page calls once a run is open: the read that keeps the scheduler alive. It is a
// script call on purpose, so a crawler fetching the page cannot keep a forgotten deployment running.
export const Route = createFileRoute("/api/read")({
  server: {
    handlers: {
      POST: () => {
        markRead();
        return new Response(null, { status: 204 });
      },
    },
  },
});
