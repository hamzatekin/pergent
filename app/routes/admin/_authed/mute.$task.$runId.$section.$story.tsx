import { createFileRoute } from "@tanstack/react-router";
import { MutePage } from "../../../components/MutePage.tsx";
import { getMutePage } from "../../../server/admin.functions.ts";

// Where a story's Never show link goes: the story's place in the stored paper.
export const Route = createFileRoute("/admin/_authed/mute/$task/$runId/$section/$story")({
  loader: ({ params }) => getMutePage({ data: params }),
  head: ({ params }) => ({ meta: [{ title: `Never show in ${params.task} · pergent admin` }] }),
  component: () => <MutePage data={Route.useLoaderData()} />,
});
