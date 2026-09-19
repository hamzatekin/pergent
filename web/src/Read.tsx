import { useEffect, useState } from "react";
import { Marked, type Token, type Tokens } from "marked";
import { api, type Run, type RunMeta } from "./api.ts";
import { Link, navigate } from "./router.tsx";

// Bare URLs on their own line (how the prompts ask for sources) render as a small "host ↗" chip
// instead of a wall of link text.
const md = new Marked({
  renderer: {
    link({ href, text }) {
      if (text !== href) return false;
      return `<a class="src" href="${href}" target="_blank" rel="noopener">${host(href)} ↗</a>`;
    },
  },
});

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Article links are matched to images without tracking parameters or a trailing slash, since the
// model sometimes copies a link with utm_ noise and sometimes without.
function canonical(url: string) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

// The output's shape: an h1 masthead, h2 sections, h3 stories. Tokens before a section's first
// story (a TL;DR list, say) are the section's lead.
type Story = { tokens: Token[]; source?: string };
type Section = { heading?: Tokens.Heading; lead: Token[]; stories: Story[] };

function structure(markdown: string) {
  let title: Tokens.Heading | undefined;
  const sections: Section[] = [];
  let section: Section | undefined;
  let story: Story | undefined;
  for (const token of md.lexer(markdown)) {
    const heading = token.type === "heading" ? (token as Tokens.Heading) : null;
    if (heading && heading.depth === 1 && !title) {
      title = heading;
    } else if (heading && heading.depth <= 2) {
      sections.push((section = { heading, lead: [], stories: [] }));
      story = undefined;
    } else if (heading && heading.depth === 3) {
      section ??= { lead: [], stories: [] };
      if (!sections.includes(section)) sections.push(section);
      section.stories.push((story = { tokens: [token] }));
    } else if (story) {
      story.tokens.push(token);
      const link = token.type === "paragraph" && token.tokens?.length === 1 && token.tokens[0].type === "link" ? token.tokens[0] : null;
      if (link && link.text === link.href) story.source = link.href;
    } else {
      section ??= { lead: [], stories: [] };
      if (!sections.includes(section)) sections.push(section);
      section.lead.push(token);
    }
  }
  return { title, sections };
}

const html = (tokens: Token[]) => ({ __html: md.parser(tokens) as string });

function Paper({ output, images }: { output: string; images: Record<string, string> }) {
  const { title, sections } = structure(output);
  const byLink = new Map(Object.entries(images ?? {}).map(([link, image]) => [canonical(link), image]));
  return (
    <div className="paper">
      {title && <h1 className="masthead">{title.text}</h1>}
      {sections.map((section, i) => (
        <section key={i} className="section">
          {section.heading && <h2 className="section-head">{section.heading.text}</h2>}
          {section.lead.length > 0 && <div className="prose lead" dangerouslySetInnerHTML={html(section.lead)} />}
          {section.stories.map((story, j) => {
            const image = story.source ? byLink.get(canonical(story.source)) : undefined;
            return (
              <article key={j} className="story">
                {image && (
                  <img
                    className="story-image"
                    src={image}
                    alt=""
                    loading="lazy"
                    onError={(e) => e.currentTarget.remove()}
                    // A feed thumbnail too small for the card looks worse than no image.
                    onLoad={(e) => e.currentTarget.naturalWidth < 300 && e.currentTarget.remove()}
                  />
                )}
                <div className="prose" dangerouslySetInnerHTML={html(story.tokens)} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function ReadView({ tasks, task, runId }: { tasks: string[]; task: string; runId?: string }) {
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    setRuns(null);
    api.runs(task).then(setRuns);
  }, [task]);

  const finished = runs?.filter((r) => r.status !== "running") ?? [];
  const current = runId ? finished.find((r) => r.runId === runId) : (finished.find((r) => r.status === "ok") ?? finished[0]);
  const index = current ? finished.indexOf(current) : -1;
  const newer = index > 0 ? finished[index - 1] : null;
  const older = index >= 0 ? finished[index + 1] : null;

  useEffect(() => {
    setRun(null);
    if (current) api.run(task, current.runId).then(setRun);
  }, [task, current?.runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && older) navigate(`/read/${task}/${older.runId}`);
      if (e.key === "ArrowRight" && newer) navigate(`/read/${task}/${newer.runId}`);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [task, older?.runId, newer?.runId]);

  useEffect(() => {
    scrollTo(0, 0);
  }, [task, current?.runId]);

  return (
    <div className="page">
      <header className="topbar">
        <nav className="tabs">
          {tasks.map((t) => (
            <Link key={t} href={`/read/${t}`} className="tab" data-active={t === task}>
              {t}
            </Link>
          ))}
        </nav>
        <div className="runnav">
          <Link href={older ? `/read/${task}/${older.runId}` : "#"} className="arrow" aria-disabled={!older} aria-label="Older run" title="Older (←)">
            ←
          </Link>
          <span className="stamp">{current ? formatDate(current.startedAt) : runs ? "no runs" : ""}</span>
          <Link href={newer ? `/read/${task}/${newer.runId}` : "#"} className="arrow" aria-disabled={!newer} aria-label="Newer run" title="Newer (→)">
            →
          </Link>
        </div>
      </header>

      {runs && !current && <p className="note">No finished runs yet.</p>}
      {current?.status === "failed" && <p className="note failed">This run failed.</p>}
      {run && run.output && <Paper output={run.output} images={run.images} />}
      {run && !run.output && current?.status === "ok" && <p className="note">This run produced no output.</p>}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
