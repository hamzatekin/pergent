import { createFileRoute } from "@tanstack/react-router";
import { IdeasBoard } from "../components/Ideas.tsx";
import { getIdeasPage } from "../server/ideas.functions.ts";

// /ideas is the radar's board of problems; ?category=<slug> one category's, ?all=true with the
// problems only one person has raised so far.
export const Route = createFileRoute("/ideas/")({
  validateSearch: (search: Record<string, unknown>): { category?: string; all?: true } => ({
    category: typeof search.category === "string" ? search.category : undefined,
    all: search.all === true || search.all === "true" ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getIdeasPage({ data: { category: deps.category, all: deps.all } }),
  head: () => ({ meta: [{ title: "Ideas · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <IdeasBoard data={Route.useLoaderData()} />,
});
