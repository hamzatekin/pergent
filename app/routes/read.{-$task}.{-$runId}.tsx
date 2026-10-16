import { createFileRoute } from "@tanstack/react-router";
import { PaperPage } from "../components/PaperPage.tsx";
import { getPaperPage } from "../server/read.functions.ts";

// /read is the front page (the PWA's start_url), /read/<task> a task's latest paper and
// /read/<task>/<runId> one run. An unknown task or run is a 404.
export const Route = createFileRoute("/read/{-$task}/{-$runId}")({
  loader: ({ params }) => getPaperPage({ data: { task: params.task, runId: params.runId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.paper?.title ? `${loaderData.paper.title} · pergent` : "pergent" }] }),
  component: () => <PaperPage data={Route.useLoaderData()} />,
});
