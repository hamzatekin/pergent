import { createFileRoute } from "@tanstack/react-router";
import { IdeasBoard } from "../components/Ideas.tsx";
import { getIdeasPage } from "../server/ideas.functions.ts";

// /ideas is the small business radar's board, ?radar=gym another radar's, in the reader's default view
// or the one ?view= names (brief, map, board; app/ideas-view.ts). ?category=<slug> keeps one category in
// any view. The brief's ?show= picks the set its list shows; the map's ?passed=true adds the passed
// problems and ?selected=<id> opens one before the page's script has.
export const Route = createFileRoute("/ideas/")({
  validateSearch: (search: Record<string, unknown>): { radar?: string; category?: string; view?: string; show?: string; passed?: true; selected?: number } => ({
    radar: typeof search.radar === "string" ? search.radar : undefined,
    category: typeof search.category === "string" ? search.category : undefined,
    view: typeof search.view === "string" ? search.view : undefined,
    show: typeof search.show === "string" ? search.show : undefined,
    passed: search.passed === true || search.passed === "true" ? true : undefined,
    selected: Number.isInteger(Number(search.selected)) && Number(search.selected) > 0 ? Number(search.selected) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getIdeasPage({ data: deps }),
  head: () => ({ meta: [{ title: "Ideas · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <IdeasBoard data={Route.useLoaderData()} />,
});
