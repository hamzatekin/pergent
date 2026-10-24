import { createFileRoute } from "@tanstack/react-router";
import { JobsBoard } from "../components/Jobs.tsx";
import { getJobsPage, type Family, type Mode, type Sponsor } from "../server/jobs.functions.ts";

// /jobs is the job market tracker's open adverts; ?family=, ?sponsor=yes|no, ?mode=, ?skill=,
// ?fit=true (a good fit for the reader) and ?pay=true filter them, ?all=true lifts the cap on how many are listed.
export const Route = createFileRoute("/jobs")({
  validateSearch: (search: Record<string, unknown>): { family?: Family; sponsor?: Sponsor; mode?: Mode; skill?: string; fit?: true; pay?: true; all?: true } => ({
    family: typeof search.family === "string" ? (search.family as Family) : undefined,
    sponsor: typeof search.sponsor === "string" ? (search.sponsor as Sponsor) : undefined,
    mode: typeof search.mode === "string" ? (search.mode as Mode) : undefined,
    skill: typeof search.skill === "string" && search.skill ? search.skill.slice(0, 40) : undefined,
    fit: search.fit === true || search.fit === "true" ? true : undefined,
    pay: search.pay === true || search.pay === "true" ? true : undefined,
    all: search.all === true || search.all === "true" ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getJobsPage({ data: deps }),
  head: () => ({ meta: [{ title: "Jobs · pergent" }, { name: "robots", content: "noindex" }] }),
  component: () => <JobsBoard data={Route.useLoaderData()} />,
});
