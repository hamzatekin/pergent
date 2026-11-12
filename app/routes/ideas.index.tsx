import { createFileRoute } from "@tanstack/react-router";
import { IdeasBoard } from "../components/Ideas.tsx";
import { getIdeasPage } from "../server/ideas.functions.ts";

// /ideas is the small business radar's home (its overview and a card per category), ?radar=gym another
// radar's; ?category=<slug> one category's overview and problems, where ?show= keeps one verdict's (or
// starred, killed, unjudged) and ?all=true adds the problems only one person has raised so far. Without a
// category, show and all are ignored.
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
