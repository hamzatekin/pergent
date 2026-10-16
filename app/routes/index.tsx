import { createFileRoute } from "@tanstack/react-router";
import { PaperPage } from "../components/PaperPage.tsx";
import { getPaperPage } from "../server/read.functions.ts";

// The front page: the first task's latest paper, the same page as /read.
export const Route = createFileRoute("/")({
  loader: () => getPaperPage({ data: {} }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData?.paper?.title ? `${loaderData.paper.title} · pergent` : "pergent" }] }),
  component: () => <PaperPage data={Route.useLoaderData()} />,
});
