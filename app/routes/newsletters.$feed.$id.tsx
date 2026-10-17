import { createFileRoute } from "@tanstack/react-router";
import { IssueView } from "../components/Newsletters.tsx";
import { getIssuePage } from "../server/newsletters.functions.ts";

// One newsletter issue as it was published.
export const Route = createFileRoute("/newsletters/$feed/$id")({
  loader: ({ params }) => getIssuePage({ data: { feed: params.feed, id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.issue.title ?? "Newsletter"} · pergent` }, { name: "robots", content: "noindex" }] }),
  component: () => <IssueView data={Route.useLoaderData()} />,
});
