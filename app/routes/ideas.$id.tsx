import { createFileRoute } from "@tanstack/react-router";
import { ProblemView } from "../components/Ideas.tsx";
import { getProblemPage } from "../server/ideas.functions.ts";

// One problem of the radar with every post that raised it.
export const Route = createFileRoute("/ideas/$id")({
  loader: ({ params }) => getProblemPage({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.problem.name ?? "Idea"} · pergent` }, { name: "robots", content: "noindex" }] }),
  component: () => <ProblemView data={Route.useLoaderData()} />,
});
