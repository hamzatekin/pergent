import { createFileRoute } from "@tanstack/react-router";
import { NewslettersList } from "../components/Newsletters.tsx";
import { getNewslettersPage } from "../server/newsletters.functions.ts";

// /newsletters lists every newsletter's issues as published, newest first; /newsletters/<slug> one
// newsletter's.
export const Route = createFileRoute("/newsletters/{-$feed}")({
  loader: ({ params }) => getNewslettersPage({ data: { feed: params.feed } }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.feed?.name ?? "Newsletters"} · pergent` }, { name: "robots", content: "noindex" }] }),
  component: () => <NewslettersList data={Route.useLoaderData()} />,
});
