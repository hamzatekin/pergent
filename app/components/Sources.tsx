import type { SourceLink, TaskSources } from "#src/sources.ts";

// The Sources panel above a paper: closed, one line naming what the task reads; open, how a run goes
// and every source by kind, built from the task's config (src/sources.ts) so it says what the before
// scripts actually fetch.
export function Sources({ sources }: { sources: TaskSources }) {
  if (!sources.groups.length && !sources.how.length) return null;
  return (
    <details className="sources">
      <summary>
        <span className="sources-title">Sources</span>
        {sources.summary && <span className="sources-sum">{sources.summary}</span>}
      </summary>
      <div className="sources-body">
        {sources.how.length > 0 && (
          <ol className="sources-how">
            {sources.how.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
        <div className="sources-groups">
          {sources.groups.map((g, i) => (
            <section key={i} className="sources-group" data-wide={g.parts?.length ? "" : undefined}>
              <h3>{g.title}</h3>
              {g.note && <p className="sources-note">{g.note}</p>}
              {g.links.length > 0 && <Chips links={g.links} />}
              {g.parts?.map((p, j) => (
                <div key={j} className="sources-part">
                  <h4>
                    {p.title}
                    <span className="count">{p.links.length}</span>
                  </h4>
                  <Chips links={p.links} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </details>
  );
}

function Chips({ links }: { links: SourceLink[] }) {
  return (
    <ul className="chips">
      {links.map((l, i) => (
        <li key={i}>
          {l.href ? (
            <a className="chip" href={l.href} {...(l.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener" })}>
              {l.label}
            </a>
          ) : (
            <span className="chip">{l.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
