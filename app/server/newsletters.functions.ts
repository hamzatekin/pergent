import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { getIssue, issueFeeds, listIssues } from "#src/db.ts";
import { listTasks, loadTask } from "#src/runner.ts";
import { PASSWORD, loggedIn } from "./admin.ts";
import { formatDay } from "./format.ts";
import { nav, type Nav } from "./nav.ts";

export type Feed = { slug: string; name: string; count: number; last?: string };
export type IssueItem = { id: number; slug: string; feed: string; title: string; day: string };
export type NewslettersPage = { nav: Nav; feeds: Feed[]; feed?: Feed; issues: IssueItem[] };
export type IssuePage = { nav: Nav; feed: Feed; issue: IssueItem & { url: string; html: string }; older?: number; newer?: number };

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The newsletters are someone else's writing, copied whole, so they are for the reader only: behind the
// admin cookie like a private task, a login without it and a 404 without ADMIN_PASSWORD.
function gate(next: string) {
  if (!PASSWORD) throw notFound();
  if (!loggedIn()) throw redirect({ to: "/admin/login", search: { next, failed: undefined } });
  setResponseHeader("cache-control", "private, no-store");
}

// Every newsletter a task fetches (its `newsletters.feeds`), so one with no issues yet is listed too,
// then any the database has that no task lists any more.
async function feeds(): Promise<Feed[]> {
  const counts = new Map(issueFeeds().map((f) => [f.feed, f]));
  const names = new Set<string>();
  for (const t of await listTasks()) {
    const config = await loadTask(t).then((x) => x.config, () => ({}) as Record<string, unknown>);
    for (const f of ((config.newsletters as { feeds?: { name: string }[] } | undefined)?.feeds ?? [])) names.add(f.name);
  }
  for (const name of counts.keys()) names.add(name);
  return [...names].map((name) => {
    const c = counts.get(name);
    return { slug: slug(name), name, count: c?.count ?? 0, last: c && formatDay(c.last) };
  });
}

const item = (i: { id: number; feed: string; title: string; date: string }): IssueItem => ({ id: i.id, slug: slug(i.feed), feed: i.feed, title: i.title, day: formatDay(i.date) });

// The issues, newest first, of every newsletter or of one (`/newsletters/<slug>`).
export const getNewslettersPage = createServerFn({ method: "GET" })
  .validator((data: { feed?: string }) => data)
  .handler(async ({ data }): Promise<NewslettersPage> => {
    gate(data.feed ? `/newsletters/${data.feed}` : "/newsletters");
    const { configs: _, ...sidebar } = await nav();
    const all = await feeds();
    const feed = data.feed ? all.find((f) => f.slug === data.feed) : undefined;
    if (data.feed && !feed) throw notFound();
    return { nav: sidebar, feeds: all, feed, issues: listIssues(feed?.name).map(item) };
  });

// One issue as published, with the newsletter's older and newer issues for the arrows.
export const getIssuePage = createServerFn({ method: "GET" })
  .validator((data: { feed: string; id: string }) => data)
  .handler(async ({ data }): Promise<IssuePage> => {
    gate(`/newsletters/${data.feed}/${data.id}`);
    const { configs: _, ...sidebar } = await nav();
    const issue = /^\d+$/.test(data.id) ? getIssue(Number(data.id)) : null;
    if (!issue || slug(issue.feed) !== data.feed) throw notFound();
    const feed = (await feeds()).find((f) => f.name === issue.feed)!;
    const siblings = listIssues(issue.feed, 1000);
    const index = siblings.findIndex((i) => i.id === issue.id);
    return {
      nav: sidebar,
      feed,
      issue: { ...item(issue), url: issue.url, html: issue.html },
      newer: siblings[index - 1]?.id,
      older: siblings[index + 1]?.id,
    };
  });
