import { useEffect, useState } from "react";
import { Marked, type Token, type Tokens } from "marked";
import { api, type Run, type RunMeta, type Status } from "./api.ts";
import { Link, navigate } from "./router.tsx";

// Bare URLs on their own line (how the prompts ask for sources) render as a small "host ↗" chip
// instead of a wall of link text. A blockquote that opens with a bold label (the prompts' "Context:"
// and "Ne olmuştu?" background asides) folds into a disclosure with the label as its handle, closed
// until the reader wants the explanation.
const md = new Marked({
  renderer: {
    link({ href, text }) {
      if (text !== href) return false;
      return `<a class="src" href="${href}" target="_blank" rel="noopener">${host(href)} ↗</a>`;
    },
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      const label = body.match(/^<p><strong>([^<]+?):?<\/strong>\s*/);
      if (!label) return false;
      return `<details class="aside"><summary>${label[1]}</summary><p>${body.slice(label[0].length)}</details>\n`;
    },
  },
});

// Task directory names stay as they are; the tabs show these labels.
const labels: Record<string, string> = { haberler: "news" };

// A task whose stories can open a "dive deeper" panel, and the task whose run holds those panels:
// a story in the companion run with the same source URL is the panel.
const deeper: Record<string, string> = { tech: "fights" };

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
      // The first bare URL is the story's source; a dive lists its spin-off posts' URLs later on.
      if (link && link.text === link.href) story.source ??= link.href;
    } else {
      section ??= { lead: [], stories: [] };
      if (!sections.includes(section)) sections.push(section);
      section.lead.push(token);
    }
  }
  return { title, sections };
}

const html = (tokens: Token[]) => ({ __html: md.parser(tokens) as string });

const isBareUrl = (token: Token) => token.type === "paragraph" && token.tokens?.length === 1 && token.tokens[0].type === "link" && token.tokens[0].text === token.tokens[0].href;
const headingOf = (token: Token, depth: number) => (token.type === "heading" && (token as Tokens.Heading).depth === depth ? (token as Tokens.Heading) : null);

// A dive's shape under its h3: a lead, then h4 subsections, each with a body and h5 items.
type Part = { heading: Tokens.Heading; body: Token[]; items: { heading: Tokens.Heading; body: Token[] }[] };

function parts(tokens: Token[]) {
  const lead: Token[] = [];
  const subs: Part[] = [];
  for (const token of tokens.slice(1)) {
    const sub = subs.at(-1);
    if (headingOf(token, 4)) subs.push({ heading: token as Tokens.Heading, body: [], items: [] });
    else if (sub && headingOf(token, 5)) sub.items.push({ heading: token as Tokens.Heading, body: [] });
    else if (sub?.items.length) sub.items.at(-1)!.body.push(token);
    else if (sub) sub.body.push(token);
    else if (!isBareUrl(token)) lead.push(token); // the story card already shows the source chip
  }
  return { lead, subs };
}

// The panel under a story. Subsections open with the panel and can be closed together; the
// spin-off items inside start closed. The details elements stay native: a change of `epoch`
// remounts them with the new default.
function Dive({ story }: { story: Story }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ epoch: 0, expanded: true });
  const { lead, subs } = parts(story.tokens);
  return (
    <div className="dive">
      <div className="dive-bar">
        <button type="button" className="dive-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Close" : "Dive deeper"}
        </button>
        {open && subs.length > 1 && (
          <button type="button" className="dive-toggle" onClick={() => setState({ epoch: state.epoch + 1, expanded: !state.expanded })}>
            {state.expanded ? "Fold all" : "Unfold all"}
          </button>
        )}
      </div>
      {open && (
        <div className="dive-body">
          {lead.length > 0 && <div className="prose" dangerouslySetInnerHTML={html(lead)} />}
          {subs.map((sub, i) => (
            <details key={`${state.epoch}-${i}`} className="dive-sec" open={state.expanded}>
              <summary>{sub.heading.text}</summary>
              {sub.body.length > 0 && <div className="prose" dangerouslySetInnerHTML={html(sub.body)} />}
              {sub.items.map((item, j) => (
                <details key={j} className="dive-item">
                  <summary>{item.heading.text}</summary>
                  <div className="prose" dangerouslySetInnerHTML={html(item.body)} />
                </details>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Paper({ output, images, dives }: { output: string; images: Record<string, string>; dives?: Map<string, Story> }) {
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
            const dive = story.source ? dives?.get(canonical(story.source)) : undefined;
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
                {dive && <Dive story={dive} />}
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
  // Fetched once, before any run is read, so it shows whether runs were paused while the paper sat unread.
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    api.status().then(setStatus, () => {});
  }, []);

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

  // The companion run that followed this one: the first ok run started after it. Its stories are
  // keyed by source URL, so a panel only appears under the story it was written for.
  const [dives, setDives] = useState<Map<string, Story> | null>(null);
  useEffect(() => {
    setDives(null);
    const companion = deeper[task];
    if (!companion || !current) return;
    let live = true;
    api
      .runs(companion)
      .then((runs) => {
        const after = runs.filter((r) => r.status === "ok" && r.startedAt >= current.startedAt).at(-1);
        return after ? api.run(companion, after.runId) : null;
      })
      .then((deep) => {
        if (!live || !deep?.output) return;
        const stories = structure(deep.output).sections.flatMap((s) => s.stories);
        setDives(new Map(stories.filter((s) => s.source).map((s) => [canonical(s.source!), s])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
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
              {labels[t] ?? t}
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

      {status?.scheduler === "paused" && (
        <p className="note">
          Scheduled runs were paused: {status.lastReadAt ? `the paper was last read ${daysAgo(status.lastReadAt)} days ago` : "the paper had not been opened yet"}. Reading it turns them back on.
        </p>
      )}
      {runs && !current && <p className="note">No finished runs yet.</p>}
      {current?.status === "failed" && <p className="note failed">This run failed.</p>}
      {run && run.output && <Paper output={run.output} images={run.images} dives={dives ?? undefined} />}
      {run && !run.output && current?.status === "ok" && <p className="note">This run produced no output.</p>}
    </div>
  );
}

function daysAgo(iso: string) {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
