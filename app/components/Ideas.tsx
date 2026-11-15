import { Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, type MouseEvent, useEffect, useState } from "react";
import { IDEAS_VIEWS, ideasViewCookie } from "../ideas-view.ts";
import type { Ask, BestBet, BoardColumn, IdeasPage, IdeaView, OverviewState, ProblemItem, ProblemPage } from "../server/ideas.functions.ts";
import { Shell } from "./Shell.tsx";
import { Sources } from "./Sources.tsx";

const TREND: Record<string, string> = { new: "New", rising: "Rising", steady: "Steady", fading: "Fading" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (n: number) => n.toLocaleString("en-GB");

// Mentions per week for the last 8 weeks as small bars, this week's on the right in the accent. An SVG
// with sizes as attributes, since the CSP allows no inline style.
function Weeks({ weeks, big }: { weeks: number[]; big?: boolean }) {
  const max = Math.max(1, ...weeks);
  const [w, h, bar] = big ? [176, 48, 18] : [64, 20, 6];
  const gap = (w - bar * weeks.length) / (weeks.length - 1);
  return (
    <svg className="weeks" data-big={big || undefined} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Mentions per week, last 8 weeks: ${weeks.join(", ")}`}>
      {weeks.map((n, i) => {
        const bh = n ? Math.max(2, (n / max) * h) : 1;
        return <rect key={i} x={i * (bar + gap)} y={h - bh} width={bar} height={bh} rx={1} data-now={i === weeks.length - 1 || undefined} data-empty={!n || undefined} />;
      })}
    </svg>
  );
}

const VERDICT: Record<string, string> = { worth: "Worth testing", watch: "Watch", pass: "Pass" };

function VerdictBadge({ verdict }: { verdict: ProblemItem["verdict"] }) {
  return verdict ? (
    <span className="verdict" data-verdict={verdict}>
      {VERDICT[verdict]}
    </span>
  ) : null;
}

function TrendBadge({ trend }: { trend: ProblemItem["trend"] }) {
  return trend ? (
    <span className="trend" data-trend={trend}>
      {TREND[trend]}
    </span>
  ) : null;
}

// The page's header: Ideas (a link back to the whole board from a category), the radar when there is
// more than one, the category, and the never-show list.
function Header({ data }: { data: IdeasPage }) {
  return (
    <>
      <h1 className="crumb">
        {data.category ? (
          <Link to="/ideas" search={{ ...data.query, category: undefined }} className="crumb-task">
            Ideas
          </Link>
        ) : (
          <span className="crumb-task">Ideas</span>
        )}
        {data.query.radar && <span className="stamp">{data.radars.find((r) => r.task === data.radar)?.label}</span>}
        {data.category && <span className="stamp">{data.category.name}</span>}
      </h1>
      <a href={`/admin/mutes/${data.radar}`} className="linkbtn">
        Never show{data.muted ? ` (${data.muted} hidden)` : ""}
      </a>
    </>
  );
}

// Where the page is on the board, as hidden fields for a form whose route sends the reader back to it.
function Back({ query }: { query: IdeasPage["query"] }) {
  return (
    <>
      {query.radar && <input type="hidden" name="radar" value={query.radar} />}
      {query.category && <input type="hidden" name="category" value={query.category} />}
      {query.view && <input type="hidden" name="view" value={query.view} />}
    </>
  );
}

// The radars on the left, the views on the right. Make default keeps the view in a cookie
// (app/ideas-view.ts), which the server reads, so /ideas opens in it.
function Bar({ data }: { data: IdeasPage }) {
  const router = useRouter();
  // A form posting to /ideas/default, so it works before the page hydrates; once it has, the click sets
  // the cookie here and the page reloads its data in place.
  const makeDefault = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // biome-ignore lint/suspicious/noDocumentCookie: the reader's default view is kept in their browser only.
    document.cookie = ideasViewCookie(data.view);
    router.invalidate();
  };
  const label = IDEAS_VIEWS.find((v) => v.view === data.view)?.label;
  return (
    <div className="ideas-bar">
      {data.radars.length > 0 ? (
        <nav className="feed-chips" aria-label="Radars">
          {data.radars.map((r, i) => (
            <Link key={r.task} to="/ideas" search={{ radar: i === 0 ? undefined : r.task, view: data.query.view }} className="chip" data-active={r.task === data.radar}>
              {r.label}
            </Link>
          ))}
        </nav>
      ) : (
        <span />
      )}
      <div className="views-wrap">
        <nav className="views" aria-label="Views">
          {IDEAS_VIEWS.map(({ view, label }) => (
            <Link key={view} to="/ideas" search={{ ...data.query, view: view === data.defaultView ? undefined : view }} className="view" data-on={view === data.view || undefined} activeOptions={{ exact: true }}>
              {label}
            </Link>
          ))}
        </nav>
        {data.view === data.defaultView ? (
          <span className="view-default">Default view</span>
        ) : (
          <form method="post" action="/ideas/default" onSubmit={makeDefault}>
            <Back query={{ ...data.query, view: undefined }} />
            <input type="hidden" name="view" value={data.view} />
            <button type="submit" className="btn ghost">
              Make {label} the default
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function CategoryChips({ data }: { data: IdeasPage }) {
  return (
    <nav className="feed-chips scroll" aria-label="Categories">
      <Link to="/ideas" search={{ ...data.query, category: undefined }} className="chip" data-active={!data.category}>
        All
      </Link>
      {data.categories.map((c) => (
        <Link key={c.slug} to="/ideas" search={{ ...data.query, category: c.slug }} className="chip" data-active={c.slug === data.category?.slug}>
          {c.name}
          <span className="chip-count">{c.count}</span>
        </Link>
      ))}
    </nav>
  );
}

// A radar's Ideas page in the view the reader picked: the brief, the map or the board.
export function IdeasBoard({ data }: { data: IdeasPage }) {
  return (
    <Shell nav={data.nav} active="ideas" header={<Header data={data} />}>
      <Bar data={data} />
      <CategoryChips data={data} />
      {data.view === "brief" ? <Brief data={data} /> : data.view === "map" ? <MapView data={data} /> : <BoardView data={data} />}
      <Foot data={data} />
    </Shell>
  );
}

// The brief: a sentence on the board, the way from posts to verdicts, the problem to start with and all
// its evidence, then the rest ranked, and what is coming up.
function Brief({ data }: { data: IdeasPage }) {
  const b = data.brief!;
  const label = b.shows.find((s) => s.show === b.show)?.label ?? "";
  return (
    <>
      <section className="answer">
        <h2 className="answer-head">{data.headline}</h2>
        {data.sub && <p className="answer-sub">{data.sub}</p>}
        {!data.category && <Funnel data={data} />}
        {data.summary && (
          <details className="answer-more">
            <summary>{data.category ? `What the overview says about ${data.category.name}` : "The overview's summary of the board"}</summary>
            <p>{data.summary}</p>
          </details>
        )}
      </section>
      {data.best && <Bet bet={data.best} query={data.query} />}
      {data.category && data.category.ideas.length > 0 && (
        <>
          <h3 className="overview-h ideas-h">The overview's ideas for {data.category.name}</h3>
          <div className="overview ideas">
            {data.category.ideas.map((idea) => (
              <Idea key={idea.name} idea={idea} />
            ))}
          </div>
        </>
      )}
      <h3 className="overview-h ideas-h">{b.show === "top" && data.best ? "Next best" : label}</h3>
      <nav className="feed-chips" aria-label="Which problems">
        {b.shows
          .filter((s) => s.count > 0 || s.show === b.show)
          .map((s) => (
            <Link key={s.show} to="/ideas" search={{ ...data.query, show: s.show }} className="chip" data-active={s.show === b.show}>
              {s.label}
              <span className="chip-count">{s.count}</span>
            </Link>
          ))}
      </nav>
      {b.list.length > 0 ? <Table items={b.list} start={b.leadIn ? 2 : 1} judged={b.show === "top" || b.show === "pass" || b.show === "starred"} withCategory={!data.category} /> : <p className="callout">Nothing here yet.</p>}
      <ComingUp data={data} />
    </>
  );
}

// From every post collected to the verdicts, one step each, so the counts below have a place.
function Funnel({ data }: { data: IdeasPage }) {
  const f = data.funnel;
  const steps: [string, string, string?][] = [
    [count(f.collected), "posts collected"],
    ...(f.kept !== f.collected ? [[count(f.kept), "kept", "promotion and chatter dropped"] as [string, string, string]] : []),
    [count(f.problems), "problems", "the posts sorted"],
    [count(f.multi), "raised by 2+ people", "the rest are one-offs"],
    ...(data.judges
      ? [
          [count(f.judged), "judged", "six questions each"] as [string, string, string],
          [`${f.worth + f.watch}`, "worth a look", `${f.worth} worth testing, ${f.watch} watch, ${f.pass} passed`] as [string, string, string],
        ]
      : []),
  ];
  return (
    <ol className="funnel" aria-label="From posts to verdicts">
      {steps.map(([n, label, hint]) => (
        <li key={label}>
          <span className="funnel-n">{n}</span>
          <span className="funnel-label">{label}</span>
          {hint && <span className="funnel-hint">{hint}</span>}
        </li>
      ))}
    </ol>
  );
}

const BET_TAG: Record<BestBet["why"], string> = { overview: "Best bet · the overview's pick", judged: "Best bet · the best judged", people: "Raised by the most people" };

// The problem to start with: what to build, the counts behind it, the six answers with the weak one
// marked, what people said, and the first step.
function Bet({ bet, query }: { bet: BestBet; query: IdeasPage["query"] }) {
  const p = bet.problem;
  const first = bet.idea?.first || p.test;
  return (
    <section className="bet">
      <p className="bet-tag">{BET_TAG[bet.why]}</p>
      <div className="bet-head">
        <h2 className="bet-name">
          <Link to="/ideas/$id" params={{ id: String(p.id) }}>
            {bet.idea?.name ?? p.name}
          </Link>
        </h2>
        <span className="badges">
          <VerdictBadge verdict={p.verdict} />
          <TrendBadge trend={p.trend} />
        </span>
      </div>
      <p className="bet-pitch">{bet.idea?.pitch ?? p.summary}</p>
      <p className="bet-from">
        {bet.idea && (
          <>
            From{" "}
            <Link to="/ideas/$id" params={{ id: String(p.id) }}>
              {p.name}
            </Link>{" "}
            ·{" "}
          </>
        )}
        {p.category}
      </p>
      <dl className="bet-stats">
        <div>
          <dt>People</dt>
          <dd>{p.people}</dd>
        </div>
        <div>
          <dt>Paid jobs</dt>
          <dd>{p.jobs}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{p.mentions}</dd>
        </div>
        <div>
          <dt>Last 8 weeks</dt>
          <dd>
            <Weeks weeks={p.weeks} />
          </dd>
        </div>
      </dl>
      {p.asks && <Asks asks={p.asks} weak={p.weak} />}
      {bet.quotes.length > 0 && (
        <div className="bet-quotes">
          {bet.quotes.map((q) => (
            <blockquote key={q.url} className="bet-quote">
              <p>“{q.text}”</p>
              <footer>
                {q.where} · {q.day}{" "}
                <a href={q.url} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </footer>
            </blockquote>
          ))}
        </div>
      )}
      {first && (
        <div className="verdict-test">
          <h4>{bet.idea?.first ? "First step" : "Smallest test"}</h4>
          <p>{first}</p>
        </div>
      )}
      {bet.idea?.risk && (
        <p className="bet-risk">
          <strong>Risk</strong> {bet.idea.risk}
        </p>
      )}
      <div className="problem-actions">
        {p.status !== "starred" && (
          <form method="post" action={`/admin/ideas/${p.id}`}>
            <input type="hidden" name="action" value="star" />
            <input type="hidden" name="back" value="1" />
            <Back query={query} />
            <button type="submit" className="btn primary">
              ★ I'm testing this
            </button>
          </form>
        )}
        <Link to="/ideas/$id" params={{ id: String(p.id) }} className="btn">
          Read the {plural(p.mentions, "post")} →
        </Link>
      </div>
    </section>
  );
}

// The six answers as five-step bars, the weak one marked, each with the verdict's reason.
function Asks({ asks, weak, compact }: { asks: Ask[]; weak: ProblemItem["weak"]; compact?: boolean }) {
  return (
    <ol className="asks" data-compact={compact || undefined}>
      {asks.map((a) => (
        <li key={a.key} data-weak={(weak && a.score === weak.score && a.why === weak.why) || undefined}>
          <span className="ask-label">{compact ? a.short : a.ask}</span>
          <span className="ask-bar" role="img" aria-label={`${a.score} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} data-on={i <= a.score || undefined} />
            ))}
          </span>
          <span className="ask-score">{a.score}</span>
          {!compact && (
            <span className="ask-why" title={a.why}>
              {a.why}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// The six scores summed as a bar out of 30.
function Fit({ fit }: { fit: number }) {
  return (
    <span className="fit">
      <svg width={48} height={6} viewBox="0 0 48 6" aria-hidden="true">
        <rect width={48} height={6} rx={3} className="fit-track" />
        <rect width={(fit / 30) * 48} height={6} rx={3} className="fit-on" />
      </svg>
      <span>{fit}/30</span>
    </span>
  );
}

// The brief's ranked list: one row per problem, its numbers side by side so they compare at a glance.
function Table({ items, start, judged, withCategory }: { items: ProblemItem[]; start: number; judged: boolean; withCategory: boolean }) {
  return (
    <div className="table-wrap">
      <table className="ptable">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Problem</th>
            <th className="num">People</th>
            <th className="num">Paid jobs</th>
            {judged ? (
              <>
                <th>Fit</th>
                <th>Weak spot</th>
              </>
            ) : (
              <>
                <th>Last 8 weeks</th>
                <th>Last seen</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={p.id}>
              <td className="num rank">{start + i}</td>
              <td>
                <Link to="/ideas/$id" params={{ id: String(p.id) }} className="ptable-name">
                  {p.status === "starred" && (
                    <span className="star" role="img" aria-label="Starred">
                      ★{" "}
                    </span>
                  )}
                  {p.name}
                </Link>
                <span className="ptable-meta">
                  {withCategory && <span>{p.category}</span>}
                  {p.verdict === "worth" && <VerdictBadge verdict={p.verdict} />}
                  <TrendBadge trend={p.trend} />
                </span>
              </td>
              <td className="num">{p.people}</td>
              <td className="num">{p.jobs || "–"}</td>
              {judged ? (
                <>
                  <td>{p.fit !== null && <Fit fit={p.fit} />}</td>
                  <td className="weak" title={p.weak?.why}>
                    {p.weak ? `${p.weak.label} (${p.weak.score}/5)` : "–"}
                  </td>
                </>
              ) : (
                <>
                  <td>
                    <Weeks weeks={p.weeks} />
                  </td>
                  <td className="when">{p.last}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// New this week and what the judge takes next, side by side.
function ComingUp({ data }: { data: IdeasPage }) {
  const lists: [string, string, ProblemItem[]][] = [
    ["New this week", "Nothing new in the last 7 days.", data.fresh],
    ...(data.judges ? [["Judged next", "Nothing waits for a verdict.", data.tonight] as [string, string, ProblemItem[]]] : []),
  ];
  if (!lists.some(([, , l]) => l.length)) return null;
  return (
    <div className="coming">
      {lists.map(([title, empty, list]) => (
        <section key={title}>
          <h3 className="overview-h">
            {title} <span className="chip-count">{list.length}</span>
          </h3>
          {list.length ? (
            <ul className="mini">
              {list.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link to="/ideas/$id" params={{ id: String(p.id) }}>
                    {p.name}
                  </Link>
                  <span>
                    {plural(p.people, "person", "people")}
                    {p.jobs ? ` · ${plural(p.jobs, "paid job")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">{empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}

// The map's two axes, from the six scores: right is demand (pain and willing to pay), up is how winnable
// it is for one person (gap, buildable, reachable). A problem past both lines is one to build.
const demandOf = (p: ProblemItem) => (score(p, "pain") + score(p, "pay")) / 2;
const winOf = (p: ProblemItem) => (score(p, "gap") + score(p, "build") + score(p, "reach")) / 3;
const score = (p: ProblemItem, key: string) => p.asks?.find((a) => a.key === key)?.score ?? 0;
const X_SPLIT = 3.75;
const Y_SPLIT = 3.25;
const QUADS = [
  { key: "build", label: "Build here", hint: "It hurts, they pay, and one person could win it.", has: (p: ProblemItem) => demandOf(p) >= X_SPLIT && winOf(p) >= Y_SPLIT },
  { key: "hard", label: "Hard to win", hint: "They pay, but tools exist, or it is hard to build or reach.", has: (p: ProblemItem) => demandOf(p) >= X_SPLIT && winOf(p) < Y_SPLIT },
  { key: "thin", label: "Winnable, thin demand", hint: "One person could do it, but the pain or the money is thin.", has: (p: ProblemItem) => demandOf(p) < X_SPLIT && winOf(p) >= Y_SPLIT },
  { key: "skip", label: "Skip for now", hint: "Weak on both.", has: (p: ProblemItem) => demandOf(p) < X_SPLIT && winOf(p) < Y_SPLIT },
];

// The map: every judged problem placed by demand and by how winnable it is, the dot as big as the people
// who raised it. Picking a dot or a name opens it beside the chart; the link is there for a page whose
// script has not run.
function MapView({ data }: { data: IdeasPage }) {
  const m = data.map!;
  const [selected, setSelected] = useState(m.selected);
  useEffect(() => setSelected(m.selected), [m.selected]);
  const href = (id: number) =>
    `/ideas?${new URLSearchParams(Object.entries({ ...data.query, view: data.query.view, passed: m.withPassed ? "true" : undefined, selected: String(id) }).filter((e): e is [string, string] => !!e[1]))}`;
  const pick = (id: number) => (e: MouseEvent) => {
    e.preventDefault();
    setSelected(id);
  };
  if (!data.judges) return <p className="callout">The map places problems by their six scores, and this radar has no judge to give them yet. The brief and the board show what it has.</p>;
  const current = m.dots.find((p) => p.id === selected);
  return (
    <>
      <div className="map-head">
        <p className="map-lede">
          <strong>Right</strong>: it hurts and they pay. <strong>Up</strong>: one person could win it. A dot is as big as the people who raised it.
        </p>
        {m.passed > 0 && (
          <Link to="/ideas" search={{ ...data.query, passed: m.withPassed ? undefined : true }} className="chip" data-active={m.withPassed}>
            {m.withPassed ? "Hide" : "Show"} {plural(m.passed, "passed problem")}
          </Link>
        )}
      </div>
      {m.dots.length === 0 ? (
        <p className="callout">Nothing judged worth a look here yet.</p>
      ) : (
        <div className="map-grid">
          <Chart dots={m.dots} selected={selected} href={href} pick={pick} />
          <aside className="map-side">{current && <Selected p={current} />}</aside>
        </div>
      )}
      <div className="quads">
        {QUADS.map((q) => {
          const here = m.dots.filter(q.has);
          return (
            <section key={q.key} className="quad" data-quad={q.key}>
              <h3>
                {q.label} <span className="chip-count">{here.length}</span>
              </h3>
              <p className="quad-hint">{q.hint}</p>
              {here.length > 0 && (
                <ul>
                  {here.map((p) => (
                    <li key={p.id}>
                      <a href={href(p.id)} onClick={pick(p.id)} aria-current={p.id === selected || undefined}>
                        {p.name}
                      </a>
                      <span>{p.people}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

const W = 640;
const H = 400;
const PAD = { left: 40, right: 16, top: 16, bottom: 44 };

// The chart itself, an SVG with every size an attribute. Problems with the same scores sit on a small
// ring around their point, the biggest drawn first so the small ones stay on top.
function Chart({ dots, selected, href, pick }: { dots: ProblemItem[]; selected: number | null; href: (id: number) => string; pick: (id: number) => (e: MouseEvent) => void }) {
  const xs = dots.map(demandOf);
  const ys = dots.map(winOf);
  const lo = (v: number[]) => Math.min(2.5, Math.floor(Math.min(...v) * 2) / 2 - 0.25);
  const [x0, x1, y0, y1] = [lo(xs), 5.25, lo(ys), Math.max(4.25, Math.max(...ys) + 0.25)];
  const px = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const py = (v: number) => H - PAD.bottom - ((v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const groups = new Map<string, ProblemItem[]>();
  for (const p of dots) {
    const key = `${demandOf(p)}:${winOf(p)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const placed = dots
    .map((p) => {
      const group = groups.get(`${demandOf(p)}:${winOf(p)}`)!;
      const i = group.indexOf(p);
      const ring = group.length > 1 ? Math.min(24, 8 + group.length * 2.5) : 0;
      const angle = (i / group.length) * 2 * Math.PI - Math.PI / 2;
      return { p, x: px(demandOf(p)) + ring * Math.cos(angle), y: py(winOf(p)) + ring * Math.sin(angle), r: Math.min(20, 3 + 1.5 * Math.sqrt(p.people)) };
    })
    .sort((a, b) => b.r - a.r);
  const chosen = placed.find((d) => d.p.id === selected);
  const ticks = (a: number, b: number) => [1, 2, 3, 4, 5].filter((t) => t >= a && t <= b);
  const name = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);
  return (
    <figure className="map">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <title>Judged problems by demand and by how winnable they are</title>
        <rect className="map-build" x={px(X_SPLIT)} y={PAD.top} width={W - PAD.right - px(X_SPLIT)} height={py(Y_SPLIT) - PAD.top} />
        <line className="map-split" x1={px(X_SPLIT)} x2={px(X_SPLIT)} y1={PAD.top} y2={H - PAD.bottom} />
        <line className="map-split" x1={PAD.left} x2={W - PAD.right} y1={py(Y_SPLIT)} y2={py(Y_SPLIT)} />
        <line className="map-axis" x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
        <line className="map-axis" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} />
        {ticks(x0, x1).map((t) => (
          <text key={`x${t}`} className="map-tick" x={px(t)} y={H - PAD.bottom + 16} textAnchor="middle">
            {t}
          </text>
        ))}
        {ticks(y0, y1).map((t) => (
          <text key={`y${t}`} className="map-tick" x={PAD.left - 8} y={py(t) + 4} textAnchor="end">
            {t}
          </text>
        ))}
        <text className="map-axis-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          it hurts and they pay →
        </text>
        <text className="map-axis-label" x={12} y={PAD.top} transform={`rotate(-90 12 ${PAD.top})`} textAnchor="end">
          one person could win it →
        </text>
        <text className="map-quad" x={W - PAD.right - 8} y={PAD.top + 16} textAnchor="end">
          BUILD HERE
        </text>
        <text className="map-quad" x={W - PAD.right - 8} y={H - PAD.bottom - 10} textAnchor="end">
          HARD TO WIN
        </text>
        <text className="map-quad" x={PAD.left + 8} y={PAD.top + 16}>
          WINNABLE, THIN DEMAND
        </text>
        <text className="map-quad" x={PAD.left + 8} y={H - PAD.bottom - 10}>
          SKIP FOR NOW
        </text>
        {placed.map(({ p, x, y, r }) => (
          <a key={p.id} href={href(p.id)} onClick={pick(p.id)} aria-label={`${p.name}: ${plural(p.people, "person", "people")}`}>
            <title>{`${p.name} · ${plural(p.people, "person", "people")}`}</title>
            <circle className="map-dot" cx={x} cy={y} r={r} data-verdict={p.verdict ?? undefined} data-selected={p.id === selected || undefined} />
          </a>
        ))}
        {chosen && (
          <text className="map-name" x={chosen.x + (chosen.x > W / 2 ? -chosen.r - 6 : chosen.r + 6)} y={chosen.y + 4} textAnchor={chosen.x > W / 2 ? "end" : "start"}>
            {name(chosen.p.name)}
          </text>
        )}
      </svg>
    </figure>
  );
}

// The problem picked on the map, with enough to decide whether to open it.
function Selected({ p }: { p: ProblemItem }) {
  return (
    <div className="sel">
      <p className="bet-tag">{p.category}</p>
      <h3 className="sel-name">
        <Link to="/ideas/$id" params={{ id: String(p.id) }}>
          {p.name}
        </Link>
      </h3>
      <span className="badges">
        <VerdictBadge verdict={p.verdict} />
        <TrendBadge trend={p.trend} />
      </span>
      <p className="sel-meta">
        {plural(p.people, "person", "people")} · {plural(p.jobs, "paid job")} · {plural(p.mentions, "post")}
      </p>
      <Weeks weeks={p.weeks} />
      {p.asks && <Asks asks={p.asks} weak={p.weak} compact />}
      {p.weak && (
        <p className="sel-weak">
          <strong>Weak spot</strong> {p.weak.why}
        </p>
      )}
      {p.test && (
        <div className="verdict-test">
          <h4>Smallest test</h4>
          <p>{p.test}</p>
        </div>
      )}
      <Link to="/ideas/$id" params={{ id: String(p.id) }} className="btn">
        Open the problem →
      </Link>
    </div>
  );
}

const EMPTY: Record<string, string> = {
  new: "Nothing new in the last 7 days.",
  tonight: "Nothing waits for a verdict.",
  raised: "Nothing raised by more than one person yet.",
  watch: "Nothing judged worth a look yet.",
  testing: "Star a problem when you start its smallest test, and it waits here.",
};

// The board: a column per stage, from new to the problems being tested, then the passed ones.
function BoardView({ data }: { data: IdeasPage }) {
  const b = data.board!;
  const columns = b.columns.filter((c) => c.key !== "watch" || data.judges);
  return (
    <>
      <p className="board-week">
        This week: {plural(b.week.problems, "new problem")} · {b.week.verdicts} judged{b.week.posts !== null && ` · ${count(b.week.posts)} new posts`}
      </p>
      <div className="kanban" data-columns={columns.length}>
        {columns.map((c) => (
          <Lane key={c.key} column={c} data={data} />
        ))}
      </div>
      {b.passed.total > 0 && (
        <section className="lane-passed">
          <h3 className="overview-h">
            Passed and killed <span className="chip-count">{b.passed.total}</span>
          </h3>
          <ul className="mini">
            {b.passed.items.map((p) => (
              <li key={p.id}>
                <Link to="/ideas/$id" params={{ id: String(p.id) }}>
                  {p.name}
                </Link>
                <span>{p.status === "killed" ? "killed" : p.weak?.label ?? "passed"}</span>
              </li>
            ))}
          </ul>
          {b.passed.total > b.passed.items.length && (
            <Link to="/ideas" search={{ ...data.query, view: data.defaultView === "brief" ? undefined : "brief", show: "pass" }} className="note-link">
              All {b.passed.total} →
            </Link>
          )}
        </section>
      )}
      {b.unjudged > 0 && (
        <p className="note more">
          {plural(b.unjudged, "more problem")} raised by 2+ people {b.unjudged === 1 ? "has" : "have"} no verdict yet.{" "}
          <Link to="/ideas" search={{ ...data.query, view: data.defaultView === "brief" ? undefined : "brief", show: "unjudged" }}>
            See them
          </Link>
        </p>
      )}
    </>
  );
}

function Lane({ column: c, data }: { column: BoardColumn; data: IdeasPage }) {
  return (
    <section className="lane" data-lane={c.key}>
      <header className="lane-head">
        <h3>{c.label}</h3>
        <span className="chip-count">{c.total}</span>
      </header>
      <p className="lane-hint">{c.hint}</p>
      {c.items.length ? (
        <ol className="cards">
          {c.items.map((p) => (
            <li key={p.id}>
              <Link to="/ideas/$id" params={{ id: String(p.id) }} className="kcard">
                <span className="kcard-name">{p.name}</span>
                {!data.category && <span className="kcard-cat">{p.category}</span>}
                <span className="kcard-meta">
                  <span>{plural(p.people, "person", "people")}</span>
                  {p.jobs > 0 && <span>{plural(p.jobs, "paid job")}</span>}
                </span>
                {p.weak && <span className="kcard-weak">{p.weak.label}</span>}
                <span className="kcard-foot">
                  <span className="badges">
                    <VerdictBadge verdict={c.key === "watch" || c.key === "testing" ? p.verdict : null} />
                    <TrendBadge trend={p.trend} />
                  </span>
                  <Weeks weeks={p.weeks} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lane-empty">{EMPTY[c.key]}</p>
      )}
      {c.total > c.items.length && c.more && (
        <Link to="/ideas" search={{ ...data.query, view: data.defaultView === "brief" ? undefined : "brief", show: c.more }} className="lane-more">
          + {c.total - c.items.length} more
        </Link>
      )}
    </section>
  );
}

// Below every view: when the overview was written and Refresh, where the posts come from, and the counts.
function Foot({ data }: { data: IdeasPage }) {
  const { totals } = data;
  return (
    <div className="ideas-foot">
      {data.overview && <OverviewFoot state={data.overview} radar={data.radar} category={data.category?.slug} view={data.query.view} />}
      <Sources sources={data.sources} />
      <p className="note feed-note">
        {count(totals.posts)} posts kept, {count(totals.sorted)} sorted into {plural(totals.problems, "problem")}
        {data.lastSort ? `, last sorted ${data.lastSort}` : ""}.{totals.waiting > 0 && ` ${count(totals.waiting)} waiting for the next sorts.`}
      </p>
    </div>
  );
}

// One business the overview thinks one person could build, with the problems it answers.
function Idea({ idea }: { idea: IdeaView }) {
  return (
    <article className="idea">
      <header className="idea-head">
        <h4 className="idea-name">{idea.name}</h4>
        {idea.best && <span className="best-badge">Start here</span>}
      </header>
      <p className="idea-pitch">{idea.pitch}</p>
      <dl className="idea-facts">
        {idea.why && (
          <div>
            <dt>Why it could work</dt>
            <dd>{idea.why}</dd>
          </div>
        )}
        {idea.risk && (
          <div>
            <dt>Risk</dt>
            <dd>{idea.risk}</dd>
          </div>
        )}
        {idea.first && (
          <div>
            <dt>First step</dt>
            <dd>{idea.first}</dd>
          </div>
        )}
      </dl>
      {idea.problems.length > 0 && (
        <ul className="idea-from" aria-label="The problems it answers">
          {idea.problems.map((p) => (
            <li key={p.id}>
              <Link to="/ideas/$id" params={{ id: String(p.id) }}>
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// When the overview was written, Refresh, and what became of the last run that wrote none. While one is
// being written the page asks the server again every 5s, so it appears without a reload.
function OverviewFoot({ state, radar, category, view }: { state: OverviewState; radar: string; category?: string; view?: string }) {
  useRefreshWhile(state.writing);
  return (
    <div className="overview-foot">
      <span className="overview-what">The overview</span>
      {state.when && (
        <span className="note" data-old={!state.fresh || undefined}>
          written {state.when}
        </span>
      )}
      <form method="post" action="/admin/ideas/overview">
        <input type="hidden" name="radar" value={radar} />
        {category && <input type="hidden" name="category" value={category} />}
        {view && <input type="hidden" name="view" value={view} />}
        <button type="submit" className="btn" disabled={state.writing || !state.canWrite}>
          {state.writing ? "Writing…" : state.when ? "Refresh" : "Write it now"}
        </button>
      </form>
      {state.lastRun && (
        <span className={state.lastRun.failed ? "note failed" : "note"}>
          {state.lastRun.text} <a href={state.lastRun.href}>See the run</a>
        </span>
      )}
    </div>
  );
}

// One problem: its counts, its weeks, and every post that raised it, each with what the sort read in it.
export function ProblemView({ data }: { data: ProblemPage }) {
  const { problem: p } = data;
  const header = (
    <h1 className="crumb">
      <Link to="/ideas" search={{ radar: data.radarLabel && p.task !== "ideas" ? p.task : undefined }} className="crumb-task">
        Ideas
      </Link>
      {data.radarLabel && <span className="stamp">{data.radarLabel}</span>}
      <Link to="/ideas" search={{ radar: data.radarLabel && p.task !== "ideas" ? p.task : undefined, category: data.categorySlug }} className="stamp">
        {p.category}
      </Link>
    </h1>
  );
  const budgets = [...new Set(p.budgets)];
  const facts: [string, string | number, boolean?][] = [
    ["People", p.people],
    ["Mentions", p.mentions],
    ["Sources", p.sources.join(", ")],
    ...(p.task === "ideas" || p.jobs ? [["Paid jobs", p.jobs || "none"] as [string, string | number]] : []),
    ["Say it recurs", p.recurring],
    ["Name a cost", p.costed],
    ["Have a workaround", p.workarounds],
    ["Seen", p.first === p.last ? p.first : `${p.first} to ${p.last}`],
    ...(budgets.length ? [["Budgets", `${budgets.slice(0, 4).join(", ")}${budgets.length > 4 ? "…" : ""}`, true] as [string, string, boolean]] : []),
  ];
  return (
    <Shell nav={data.nav} active="ideas" header={header}>
      <article className="problem">
        <div className="problem-head">
          <h2 className="masthead">
            {p.status === "starred" && <span className="star" role="img" aria-label="Starred">★ </span>}
            {p.name}
          </h2>
          <span className="badges">
            {p.status === "killed" && <span className="verdict">Killed</span>}
            <TrendBadge trend={p.trend} />
          </span>
        </div>
        <p className="problem-lede">{p.summary}</p>
        <Actions data={data} />
        <VerdictCard data={data} />
        <div className="problem-facts">
          <dl className="stats">
            {facts.map(([k, v, wide]) => (
              <div key={k} data-wide={wide || undefined}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <figure className="problem-weeks">
            <Weeks weeks={p.weeks} big />
            <figcaption>Mentions a week, last 8 weeks</figcaption>
          </figure>
        </div>
        <h3 className="problem-h">What people said</h3>
        <ol className="mentions">
          {data.mentions.map((m) => (
            <li key={m.id} className="mention">
              <p className="mention-quote">{m.quote || m.title}</p>
              <p className="mention-meta">
                <span>{m.community}</span>
                <span>{m.day}</span>
                {m.budget ? <span>budget {m.budget}</span> : m.author && <span>{m.author}</span>}
                <a href={m.url} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </p>
              {(m.recurring || m.cost || m.workaround) && (
                <p className="chips">
                  {m.recurring && <span className="chip">recurs</span>}
                  {m.cost && <span className="chip">{m.cost}</span>}
                  {m.workaround && <span className="chip">today: {m.workaround}</span>}
                </p>
              )}
              <details className="mention-post">
                <summary>{m.title}</summary>
                <p>{m.body || "No text, only the title."}</p>
              </details>
            </li>
          ))}
        </ol>
      </article>
    </Shell>
  );
}

// Star, Kill, Judge again and Merge: plain forms posting to /admin/ideas/<id>, which redirects back.
function Actions({ data }: { data: ProblemPage }) {
  const { problem: p } = data;
  const action = `/admin/ideas/${p.id}`;
  const button = (name: string, label: string, primary = false, disabled = false) => (
    <form method="post" action={action}>
      <input type="hidden" name="action" value={name} />
      <button type="submit" className={primary ? "btn primary" : "btn"} disabled={disabled}>
        {label}
      </button>
    </form>
  );
  return (
    <div className="problem-actions">
      {p.status === "starred" ? button("reopen", "Unstar") : p.status !== "killed" && button("star", "★ Star")}
      {p.status === "killed" ? button("reopen", "Reopen") : button("kill", "Kill")}
      {data.canJudge && button("judge", data.judging ? "Judging…" : data.asked ? "Asked, judging next run" : data.verdict ? "Judge again" : "Judge now", false, data.asked)}
      {data.mergeTargets.length > 0 && (
        <form method="post" action={action} className="merge">
          <input type="hidden" name="action" value="merge" />
          <select name="into" aria-label="Merge into" defaultValue="">
            <option value="" disabled>
              Merge into…
            </option>
            {data.mergeTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Merge
          </button>
        </form>
      )}
    </div>
  );
}

// The verdict: code's call from the model's six scores, the reason, the competitors the search found,
// the market guess and the smallest test.
function VerdictCard({ data }: { data: ProblemPage }) {
  const v = data.verdict;
  if (!v)
    return (
      <p className="callout">
        {!data.canJudge
          ? "This radar has no verdicts yet: it only collects and counts."
          : data.overBar
          ? "Not judged yet. The nightly run will take it, or press Judge now."
          : "Not judged yet: the nightly run waits for 4 mentions from 3 people, or a paid job and 2 more posts. Judge now to judge it anyway."}
      </p>
    );
  return (
    <section className="verdict-card" data-verdict={v.verdict}>
      <header className="verdict-top">
        <VerdictBadge verdict={v.verdict} />
        <span className="note">
          judged {v.day} at {plural(v.mentions, "mention")}
          {data.earlier.length > 0 && `; before: ${data.earlier.map((e) => `${e.label} on ${e.day}`).join(", ")}`}
        </span>
      </header>
      {v.hardNo && <p className="hard-no">Hard no: {v.hardNo}</p>}
      <p className="verdict-reason">{v.reason}</p>
      <ol className="scores">
        {v.scores.map((s) => (
          <li key={s.key}>
            <span className="score-label">{s.label}</span>
            <span className="dots" role="img" aria-label={`${s.score} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} data-on={i <= s.score || undefined} />
              ))}
            </span>
            <span className="score-why">{s.why}</span>
          </li>
        ))}
      </ol>
      {v.test && (
        <div className="verdict-test">
          <h4>Smallest test</h4>
          <p>{v.test}</p>
        </div>
      )}
      {v.competitors.length > 0 && (
        <div className="verdict-part">
          <h4>What exists</h4>
          <ul className="competitors">
            {v.competitors.map((c) => (
              <li key={c.name}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name} ↗
                  </a>
                ) : (
                  <strong>{c.name}</strong>
                )}{" "}
                {c.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.size && (
        <div className="verdict-part">
          <h4>Market, a guess</h4>
          <p>{v.size}</p>
        </div>
      )}
    </section>
  );
}

// While an overview is being written the page asks the server again every 5s.
function useRefreshWhile(busy: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.invalidate(), 5_000);
    return () => clearInterval(timer);
  }, [busy, router]);
}
