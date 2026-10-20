import { createFileRoute } from "@tanstack/react-router";
import { BriefsList } from "../components/Ideas.tsx";
import { getBriefsPage } from "../server/ideas.functions.ts";

// Every brief the radar has written, newest first.
export const Route = createFileRoute("/ideas/briefs")({
  loader: () => getBriefsPage(),
  head: () => ({ meta: [{ title: "Briefs · Ideas · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <BriefsList data={Route.useLoaderData()} />,
});
