import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TaskConfig } from "./runner.ts";

// What a task reads and how its paper is made, for the Sources panel on its page. Built from the task's
// own config each time, so the panel cannot drift from what the before scripts fetch: the scripts named
// in `before` say which kinds of source there are, and their config keys say which ones. A script this
// file does not know adds nothing.

export type SourceLink = { label: string; href?: string };
export type SourceGroup = {
  title: string;
  /** One line on what is taken from it. */
  note?: string;
  links: SourceLink[];
  /** Named subgroups, such as X handles by group. */
  parts?: { title: string; links: SourceLink[] }[];
};
export type TaskSources = {
  /** The steps of a run, in order, one plain sentence each. */
  how: string[];
  groups: SourceGroup[];
  /** The groups in a few words, for the closed panel. */
  summary: string;
};

const TASKS_DIR = resolve(import.meta.dirname, "../tasks");

const x = (handle: string): SourceLink => ({ label: `@${handle}`, href: `https://x.com/${handle}` });
const origin = (url: string) => new URL(url).origin;
const words = (slug: string) => {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const titleCase = (slug: string) => slug.split(/[-_\s]+/).map((w) => (w === "and" ? w : w === "uk" ? "UK" : words(w))).join(" ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `claude-haiku-5-5` as "Haiku 5.5", `sonnet` as "Sonnet". */
export function modelName(model?: string): string {
  if (!model) return "Claude";
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (m) return `${words(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  return words(model);
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A five-field cron as a sentence when it is a plain daily or weekly time, else the cron itself. */
export function scheduleText(cron?: string, timezone?: string): string | undefined {
  if (!cron) return undefined;
  const zone = timezone ? ` ${timezone.split("/").pop()!.replace(/_/g, " ")} time` : "";
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (!/^\d+$/.test(min ?? "") || !/^\d+$/.test(hour ?? "") || dom !== "*" || mon !== "*") return `Runs on the schedule ${cron}${zone}`;
  const at = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}${zone}`;
  if (dow === "*") return `Runs every day at ${at}`;
  if (dow === "1-5") return `Runs on weekdays at ${at}`;
  if (/^[0-7](,[0-7])*$/.test(dow)) return `Runs on ${dow.split(",").map((d) => DAYS[Number(d) % 7]).join(" and ")} at ${at}`;
  return `Runs on the schedule ${cron}${zone}`;
}

async function xGroups(task: string, cfg: any): Promise<SourceGroup[]> {
  const groups: SourceGroup[] = [];
  if (cfg?.lists?.length || cfg?.handles) {
    const parts: SourceGroup["parts"] = [];
    const notes: string[] = [];
    for (const list of (cfg.lists ?? []) as { file?: string; url?: string; categories?: string[] }[]) {
      if (list.file) {
        // The committed list: its accounts by category, in the config's category order.
        const body = await readFile(join(TASKS_DIR, task, list.file), "utf8").then(JSON.parse, () => null);
        if (!body) continue;
        const titles = new Map<string, string>((body.categories ?? []).map((c: { id: string; title?: string }) => [c.id, c.title ?? c.id]));
        const ids: string[] = list.categories ?? [...titles.keys()];
        for (const id of ids) {
          const handles = (body.accounts ?? []).filter((a: { category?: string }) => a.category === id).map((a: { handle: string }) => a.handle);
          if (handles.length) parts.push({ title: (titles.get(id) ?? id).replace(/^\P{L}+/u, ""), links: handles.map(x) });
        }
      } else if (list.url) {
        const m = /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//.exec(list.url);
        notes.push(m ? `plus ${m[1]} when it answers` : "plus a remote list");
      }
    }
    for (const [title, handles] of Object.entries((cfg.handles ?? {}) as Record<string, string[]>)) parts.push({ title, links: handles.map(x) });
    const count = new Set(parts.flatMap((p) => p.links.map((l) => l.label.toLowerCase()))).size;
    const hours = cfg.hours ?? 24;
    groups.push({
      title: `${count} X accounts`,
      note: `Their posts of the last ${hours} hours, through FxTwitter${notes.length ? `; ${notes.join(", ")}` : ""}.`,
      links: [],
      parts,
    });
  }
  if (cfg?.techtwitter !== false)
    groups.push({ title: "techtwitter.com", note: "What tech Twitter is discussing, ranked by discussion.", links: [{ label: "techtwitter.com", href: "https://www.techtwitter.com" }] });
  return groups;
}

function newsletterGroup(cfg: any): SourceGroup | undefined {
  const feeds = (cfg?.feeds ?? []) as { name: string; url?: string; sitemap?: string }[];
  if (!feeds.length) return undefined;
  return {
    title: plural(feeds.length, "newsletter"),
    note: `Every new issue, each delivered once, looking back up to ${cfg.days ?? 7} days.`,
    links: feeds.map((f) => {
      const url = f.sitemap ?? f.url;
      // A beehiiv RSS host is the feed itself, not the newsletter's site.
      return { label: f.name, href: url && !url.includes("rss.beehiiv.com") ? origin(url) : undefined };
    }),
  };
}

function painsGroups(cfg: any): SourceGroup[] {
  const groups: SourceGroup[] = [];
  const reddit = (cfg?.reddit ?? []) as { subs: string[]; search?: string }[];
  const subs = [...new Map(reddit.flatMap((r) => r.subs).map((s) => [s.toLowerCase(), s])).values()];
  if (subs.length)
    groups.push({
      title: plural(subs.length, "subreddit"),
      note: `${reddit.some((r) => r.search) ? "A search for pain phrases (“is there a tool”, “spreadsheet”, “manually”…) over the week, then the" : "The"} newest posts of the last ${cfg.hours ?? 48} hours.`,
      links: subs.map((s) => ({ label: `r/${s}`, href: `https://www.reddit.com/r/${s}/` })),
    });
  const fl = cfg?.freelancer;
  if (fl?.queries?.length)
    groups.push({
      title: "Freelancer.com",
      note: `Open projects paid in ${(fl.currencies ?? ["USD", "GBP"]).join(" or ")}, searched for:`,
      links: fl.queries.map((q: string) => ({ label: q })),
    });
  for (const k of (cfg?.khoros ?? []) as { host: string; name?: string }[])
    groups.push({ title: k.name ?? k.host, note: `Its boards, the last ${cfg.forumDays ?? 14} days.`, links: [{ label: k.host, href: `https://${k.host}` }] });
  return groups;
}

function settlementGroups(cfg: any): SourceGroup[] {
  const groups: SourceGroup[] = [];
  const pages = (cfg?.govuk?.pages ?? []) as string[];
  if (pages.length)
    groups.push({
      title: plural(pages.length, "GOV.UK page"),
      note: "Watched every day for a change.",
      links: pages.map((p) => ({ label: words(p.split("/").pop()!), href: `https://www.gov.uk${p}` })),
    });
  const orgs = (cfg?.govuk?.organisations ?? []) as string[];
  if (orgs.length)
    groups.push({
      title: "GOV.UK publications",
      note: "New publications on settlement and the Skilled Worker route from:",
      links: orgs.map((o) => ({ label: titleCase(o), href: `https://www.gov.uk/government/organisations/${o}` })),
    });
  if (cfg?.parliament)
    groups.push({
      title: "Parliament",
      note: "Home Office written statements and answers, and what was said in Hansard about:",
      links: [
        { label: "Written questions and statements", href: "https://questions-statements.parliament.uk" },
        ...((cfg.parliament.hansard ?? []) as string[]).map((t) => ({ label: `“${t}”` })),
      ],
    });
  const queries = (cfg?.news?.queries ?? []) as string[];
  if (queries.length)
    groups.push({
      title: "Google News",
      note: "Headlines only, for:",
      links: queries.map((q) => ({ label: q, href: `https://news.google.com/search?${new URLSearchParams({ q, hl: "en-GB", gl: "GB", ceid: "GB:en" })}` })),
    });
  const feeds = (cfg?.feeds ?? []) as { name: string; url: string }[];
  if (feeds.length) groups.push({ title: plural(feeds.length, "feed"), note: "Posts about settlement.", links: feeds.map((f) => ({ label: f.name, href: origin(f.url) })) });
  return groups;
}

/** The Sources panel of `task`. */
export async function taskSources(task: string, config: TaskConfig): Promise<TaskSources> {
  const scripts = [...(config.before ?? "").matchAll(/scripts\/([\w-]+)\.ts/g)].map((m) => m[1]);
  const c = config as Record<string, any>;
  const groups: SourceGroup[] = [];
  const how: string[] = [];
  const jev = !!process.env.TYPESAFE_API_KEY;

  const schedule = scheduleText(config.schedule, config.timezone);
  if (schedule) how.push(`${schedule}.`);
  for (const script of scripts) {
    if (script === "fetch-x") groups.push(...(await xGroups(task, c.x)));
    if (script === "fetch-hn")
      groups.push({
        title: "Hacker News",
        note: `The front page, plus stories over ${c.hn?.minPoints ?? 80} points in the last ${c.hn?.hours ?? 24} hours.`,
        links: [{ label: "news.ycombinator.com", href: "https://news.ycombinator.com" }],
      });
    if (script === "fetch-newsletters") {
      const g = newsletterGroup(c.newsletters);
      if (g) groups.push(g);
    }
    if (script === "fetch-bundle")
      groups.push({
        title: "Bundle",
        note: `The popular list and the last ${c.bundle?.hours ?? 24} hours of the feed.`,
        links: [{ label: "bundle.app", href: "https://www.bundle.app" }],
      });
    if (script === "fetch-pains") groups.push(...painsGroups(c.pains));
    if (script === "fetch-settlement") groups.push(...settlementGroups(c.settlement));
    // The filter and the for-you score only run with TypeSafe's key, so the panel only claims them then.
    if (script === "filter-jev" && jev) {
      const drop = ((c.filter?.drop ?? ["clickbait", "filler", "praise"]) as string[]).map((k) => k.replace(/-/g, " "));
      how.push(`Jev (TypeSafe) reads every item first and drops ${drop.join(", ").replace(/, ([^,]*)$/, " and $1")} when it is at least ${Math.round((c.filter?.threshold ?? 0.8) * 100)}% sure.`);
    }
  }
  if (scripts.includes("previous")) how.push(`It is shown its own papers of the last ${c.previous?.days ?? 3} days, to know what it has already said.`);
  if (scripts.includes("fetch-settlement")) how.push("It is shown its last paper, and carries its answers forward until a source changes them.");
  if (config.mute) how.push("Your never-show list is left out.");
  const tools = config.allowedTools ?? [];
  how.push(`${modelName(config.model)} writes the paper${tools.includes("WebFetch") ? ", opening a few of the linked articles" : " from what was fetched, with no tools"}.`);
  if (config.reader && config.rate !== false && jev) how.push("Jev scores every story by how much it matters to you; each section puts those first, and what is not for you drops to the briefs.");

  const summary = groups.map((g) => g.title).join(" · ");
  return { how, groups, summary };
}
