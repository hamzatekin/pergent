import { createFileRoute } from "@tanstack/react-router";
import { HomesBoard } from "../components/Homes.tsx";
import { getHomesPage, type Beds, type Epc, type HomesSearch, type Sort } from "../server/homes.functions.ts";

const BEDS: Beds[] = ["0", "1", "2", "3"];
const EPC: Epc[] = ["any", "good", "unknown", "poor"];
const SORT: Sort[] = ["fit", "rent", "allin", "near", "new"];
const flag = (v: unknown) => (v === true || v === "true" ? true : undefined);
const oneOf = <T extends string>(values: T[], v: unknown) => (values.includes(String(v) as T) ? (String(v) as T) : undefined);

// /homes is the rental search (tasks/homes): the listings that match what the reader is after, or
// every one with ?view=all; ?beds=, ?epc=, ?area= (a postcode district), ?bills, ?fit, ?fresh, ?reduced
// and ?safer (crime average or lower) filter them, ?sort=rent|allin|near|new orders them, ?more lifts the cap on how many are listed.
export const Route = createFileRoute("/homes")({
  validateSearch: (search: Record<string, unknown>): HomesSearch => ({
    view: search.view === "all" ? "all" : undefined,
    beds: oneOf(BEDS, search.beds),
    epc: oneOf(EPC, search.epc),
    area: typeof search.area === "string" && /^NG\d{1,2}$/i.test(search.area) ? search.area.toUpperCase() : undefined,
    bills: flag(search.bills),
    fit: flag(search.fit),
    safer: flag(search.safer),
    fresh: flag(search.fresh),
    reduced: flag(search.reduced),
    sort: oneOf(SORT, search.sort),
    more: flag(search.more),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getHomesPage({ data: deps }),
  head: () => ({ meta: [{ title: "Homes · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <HomesBoard data={Route.useLoaderData()} />,
});
