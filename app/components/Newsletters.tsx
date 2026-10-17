import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { IssuePage, NewslettersPage } from "../server/newsletters.functions.ts";
import { Icon } from "./Icon.tsx";
import { Shell } from "./Shell.tsx";

// The newsletters as they were published, without the model: a row of the newsletters to filter by,
// then their issues, newest first. The tech paper is built from the same issues.
export function NewslettersList({ data }: { data: NewslettersPage }) {
  const header = (
    <h1 className="crumb">
      <span className="crumb-task">Newsletters</span>
      {data.feed && <span className="stamp">{data.feed.name}</span>}
    </h1>
  );
  return (
    <Shell nav={data.nav} active="newsletters" header={header}>
      <nav className="feed-chips">
        <Link to="/newsletters/{-$feed}" params={{ feed: undefined }} className="chip" data-active={!data.feed}>
          All
        </Link>
        {data.feeds.map((f) => (
          <Link key={f.slug} to="/newsletters/{-$feed}" params={{ feed: f.slug }} className="chip" data-active={data.feed?.slug === f.slug}>
            {f.name}
            <span className="chip-count">{f.count}</span>
          </Link>
        ))}
      </nav>
      {data.feed && <p className="note feed-note">{data.feed.last ? `${data.feed.count} ${data.feed.count === 1 ? "issue" : "issues"}, the newest from ${data.feed.last}.` : "No issues yet. They arrive with the tech paper's morning fetch."}</p>}
      {data.issues.length > 0 ? (
        <ol className="issues">
          {data.issues.map((i) => (
            <li key={i.id}>
              <Link to="/newsletters/$feed/$id" params={{ feed: i.slug, id: String(i.id) }} className="issue-row">
                <span className="issue-title">{i.title}</span>
                <span className="issue-meta">
                  {!data.feed && <span className="issue-feed">{i.feed}</span>}
                  <span className="stamp">{i.day}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        !data.feed && <p className="callout">No issues yet. They arrive with the tech paper's morning fetch.</p>
      )}
    </Shell>
  );
}

// One issue, cleaned of the email's styling but otherwise whole. ← and → step to the newsletter's
// older and newer issues.
export function IssueView({ data }: { data: IssuePage }) {
  const navigate = useNavigate();
  const { feed, issue, older, newer } = data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const to = e.key === "ArrowLeft" ? older : e.key === "ArrowRight" ? newer : undefined;
      if (to) navigate({ to: "/newsletters/$feed/$id", params: { feed: feed.slug, id: String(to) } });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [navigate, feed.slug, older, newer]);

  const header = (
    <>
      <h1 className="crumb">
        <Link to="/newsletters/{-$feed}" params={{ feed: feed.slug }} className="crumb-task">
          {feed.name}
        </Link>
        <span className="stamp">{issue.day}</span>
      </h1>
      <div className="runnav">
        <IssueArrow slug={feed.slug} id={older} label="Older issue" glyph="left" keyName="ArrowLeft" />
        <IssueArrow slug={feed.slug} id={newer} label="Newer issue" glyph="right" keyName="ArrowRight" />
      </div>
    </>
  );

  return (
    <Shell nav={data.nav} active="newsletters" header={header}>
      <article className="issue">
        <h2 className="masthead">{issue.title}</h2>
        <p className="issue-byline">
          {feed.name} · {issue.day} ·{" "}
          <a href={issue.url} target="_blank" rel="noreferrer">
            Original ↗
          </a>
        </p>
        <div className="prose issue-body" dangerouslySetInnerHTML={{ __html: issue.html }} />
      </article>
    </Shell>
  );
}

function IssueArrow({ slug, id, label, glyph, keyName }: { slug: string; id?: number; label: string; glyph: string; keyName: string }) {
  const title = `${label} (${keyName})`;
  if (!id) {
    return (
      <a className="arrow" aria-disabled="true" aria-label={label} title={title}>
        <Icon name={glyph} />
      </a>
    );
  }
  return (
    <Link to="/newsletters/$feed/$id" params={{ feed: slug, id: String(id) }} className="arrow" aria-label={label} title={title}>
      <Icon name={glyph} />
    </Link>
  );
}
