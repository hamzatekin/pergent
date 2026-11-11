import { createFileRoute } from "@tanstack/react-router";
import { IdeasBoard } from "../components/Ideas.tsx";
import { getIdeasPage } from "../server/ideas.functions.ts";

// /ideas is the small business radar's board of problems, ?radar=gym another radar's; ?category=<slug>
// one category's, ?show= one verdict's (or starred, killed, unjudged), ?all=true with the problems only
// one person has raised so far.
export const Route = createFileRoute("/ideas/")({
  validateSearch: (search: Record<string, unknown>): { radar?: string; category?: string; all?: true; show?: string } => ({
    radar: typeof search.radar === "string" ? search.radar : undefined,
    category: typeof search.category === "string" ? search.category : undefined,
    show: typeof search.show === "string" ? search.show : undefined,
    all: search.all === true || search.all === "true" ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getIdeasPage({ data: { radar: deps.radar, category: deps.category, all: deps.all, show: deps.show } }),
  head: () => ({ meta: [{ title: "Ideas · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <IdeasBoard data={Route.useLoaderData()} />,
});
