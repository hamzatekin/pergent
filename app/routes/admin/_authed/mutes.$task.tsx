import { createFileRoute } from "@tanstack/react-router";
import { MutePage } from "../../../components/MutePage.tsx";
import { getMutePage } from "../../../server/admin.functions.ts";

// A task's never-show list on its own, with Undo per phrase.
export const Route = createFileRoute("/admin/_authed/mutes/$task")({
  loader: ({ params }) => getMutePage({ data: { task: params.task } }),
  head: ({ params }) => ({ meta: [{ title: `Never show in ${params.task} · pergent admin` }] }),
  component: () => <MutePage data={Route.useLoaderData()} />,
});
