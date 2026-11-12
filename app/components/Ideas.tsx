import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { IdeaView, IdeasCategory, IdeasHome, IdeasPage, OverviewState, ProblemItem, ProblemPage } from "../server/ideas.functions.ts";
import { Shell } from "./Shell.tsx";
import { Sources } from "./Sources.tsx";

const TREND: Record<string, string> = { new: "New", rising: "Rising", steady: "Steady", fading: "Fading" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The counts behind a problem in one line: people, where, paid jobs, when it was last raised.
function evidence(p: ProblemItem) {
  return [
    plural(p.people, "person", "people"),
    p.sources.length > 1 ? plural(p.sources.length, "source") : p.sources[0],
    p.jobs && plural(p.jobs, "paid job"),
    p.recurring && `${p.recurring} say it recurs`,
  ].filter(Boolean);
}

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

// The page's header: Ideas (a link home from a category), the radar when there is more than one, the
// category, and the never-show list.
function Header({ data, category }: { data: IdeasPage; category?: string }) {
  const radar = radarParam(data);
  return (
    <>
      <h1 className="crumb">
        {category ? (
          <Link to="/ideas" search={{ radar }} className="crumb-task">
            Ideas
          </Link>
        ) : (
          <span className="crumb-task">Ideas</span>
        )}
        {radar && <span className="stamp">{data.radars.find((r) => r.task === radar)?.label}</span>}
        {category && <span className="stamp">{category}</span>}
      </h1>
      <a href={`/admin/mutes/${data.radar}`} className="linkbtn">
        Never show{data.muted ? ` (${data.muted} hidden)` : ""}
      </a>
    </>
  );
}

// The small business radar is /ideas itself; another radar carries ?radar=.
const radarParam = (data: IdeasPage) => (data.radars[0] && data.radar !== data.radars[0].task ? data.radar : undefined);

const anchor = (idea: IdeaView) => `idea-${idea.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function RadarChips({ data }: { data: IdeasPage }) {
  if (!data.radars.length) return null;
  return (
    <nav className="feed-chips" aria-label="Radars">
      {data.radars.map((r, i) => (
        <Link key={r.task} to="/ideas" search={{ radar: i === 0 ? undefined : r.task }} className="chip" data-active={r.task === data.radar}>
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

// A radar's Ideas page: its home, or one of its categories.
export function IdeasBoard({ data }: { data: IdeasPage }) {
  return data.kind === "home" ? <Home data={data} /> : <Category data={data} />;
}

// The home: what the nightly overview makes of the whole board and the ideas it would start with, then a
// card per category, the reader's starred problems, and where the posts come from.
function Home({ data }: { data: IdeasHome }) {
  const { totals } = data;
  const radar = radarParam(data);
  return (
    <Shell nav={data.nav} active="ideas" header={<Header data={data} />}>
      <RadarChips data={data} />
      {data.overview && (
        <section className="overview">
          {data.summary ? (
            <>
              <p className="overview-summary">{data.summary}</p>
              {data.best.length > 0 && (
                <>
                  <h3 className="overview-h">Start with</h3>
                  <ol className="best">
                    {data.best.map((idea) => (
                      <li key={idea.name}>
                        <Link to="/ideas" search={{ radar, category: idea.category.slug }} hash={anchor(idea)} className="best-idea">
                          <span className="best-name">{idea.name}</span>
                          <span className="best-pitch">{idea.pitch}</span>
                          <span className="best-cat">{idea.category.name} →</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          ) : (
            <p className="overview-empty">No overview yet. Each night the radar sums up the whole board and, for each category, what one person could build from it.</p>
          )}
          <OverviewFoot state={data.overview} radar={data.radar} />
        </section>
      )}
      {data.categories.length > 0 ? (
        <>
          <h3 className="overview-h ideas-h">Categories</h3>
          <ul className="cats">
            {data.categories.map((c) => (
              <li key={c.slug}>
                <Link to="/ideas" search={{ radar, category: c.slug }} className="cat">
                  <span className="cat-name">{c.name}</span>
                  {c.take && <span className="cat-take">{c.take}</span>}
                  <span className="cat-foot">
                    <span className="problem-meta">
                      {c.problems > 0 ? (
                        <>
                          <span>{plural(c.problems, "problem")}</span>
                          <span>{plural(c.people, "person", "people")}</span>
                        </>
                      ) : (
                        <span>{c.oneOffs ? `${plural(c.oneOffs, "problem")} raised by one person so far` : "Only killed problems"}</span>
                      )}
                      {c.worth > 0 && <span className="cat-worth">{c.worth} worth testing</span>}
                      {c.watch > 0 && <span>{c.watch} to watch</span>}
                    </span>
                    {c.ideas > 0 && <span className="cat-ideas">{plural(c.ideas, "idea")}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="callout">{totals.sorted === 0 ? "Nothing sorted yet. The radar sorts new posts after each collection." : "No problem has been raised by more than one person yet."}</p>
      )}
      {data.starred.length > 0 && (
        <>
          <h3 className="overview-h ideas-h">Your starred</h3>
          <Problems problems={data.starred} withCategory />
        </>
      )}
      <div className="ideas-foot">
        <Sources sources={data.sources} />
        <p className="note feed-note">
          {totals.posts.toLocaleString("en-GB")} posts collected, {totals.sorted.toLocaleString("en-GB")} sorted into {plural(totals.problems, "problem")}
          {data.lastSort ? `, last sorted ${data.lastSort}` : ""}.{totals.waiting > 0 && ` ${totals.waiting.toLocaleString("en-GB")} waiting for the next sorts.`}
        </p>
      </div>
    </Shell>
  );
}

// One category: the overview's summary of it and the businesses one person could build from it, then its
// problems, starred first, then by verdict and people. By default a problem only one person raised is
// left out until someone else does.
function Category({ data }: { data: IdeasCategory }) {
  const radar = radarParam(data);
  const { category } = data;
  return (
    <Shell nav={data.nav} active="ideas" header={<Header data={data} category={category.name} />}>
      <nav className="feed-chips scroll" aria-label="Categories">
        <Link to="/ideas" search={{ radar }} className="chip">
          Overview
        </Link>
        {data.categories.map((c) => (
          <Link key={c.slug} to="/ideas" search={{ radar, category: c.slug }} className="chip" data-active={c.slug === category.slug}>
            {c.name}
            <span className="chip-count">{c.count}</span>
          </Link>
        ))}
      </nav>
      {data.overview && (
        <section className="overview">
          {category.summary ? (
            <>
              <p className="overview-summary">{category.summary}</p>
              <h3 className="overview-h">What one person could build</h3>
              {category.ideas.length > 0 ? (
                <div className="ideas">
                  {category.ideas.map((idea) => (
                    <Idea key={idea.name} idea={idea} />
                  ))}
                </div>
              ) : (
                <p className="overview-empty">Nothing here yet that one person could build a business on.</p>
              )}
            </>
          ) : (
            <p className="overview-empty">The overview has nothing on this category yet: each night it covers the problems raised by more than one person, judged or starred.</p>
          )}
          <OverviewFoot state={data.overview} radar={data.radar} category={category.slug} />
        </section>
      )}
      <h3 className="overview-h ideas-h">Problems</h3>
      <nav className="feed-chips">
        <Link to="/ideas" search={{ radar, category: category.slug, all: data.all || undefined }} className="chip" data-active={!data.show}>
          Everything
        </Link>
        {data.shows
          .filter((s) => s.count > 0 || s.show === data.show)
          .map((s) => (
            <Link key={s.show} to="/ideas" search={{ radar, category: category.slug, all: data.all || undefined, show: s.show }} className="chip" data-active={s.show === data.show}>
              {s.label}
              <span className="chip-count">{s.count}</span>
            </Link>
          ))}
      </nav>
      {data.problems.length > 0 ? (
        <Problems problems={data.problems} />
      ) : (
        <p className="callout">{data.all || data.show ? "No problems here yet." : "No problem here has been raised by more than one person yet."}</p>
      )}
      {(data.oneOffs > 0 || data.all) && (
        <p className="note more">
          {data.all ? (
            <Link to="/ideas" search={{ radar, category: category.slug, show: data.show }}>
              Only problems more than one person raised
            </Link>
          ) : (
            <Link to="/ideas" search={{ radar, category: category.slug, all: true, show: data.show }}>
              Show {plural(data.oneOffs, "problem")} only one person raised so far
            </Link>
          )}
        </p>
      )}
    </Shell>
  );
}

// One business the overview thinks one person could build, with the problems it answers.
function Idea({ idea }: { idea: IdeaView }) {
  return (
    <article className="idea" id={anchor(idea)}>
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
function OverviewFoot({ state, radar, category }: { state: OverviewState; radar: string; category?: string }) {
  useRefreshWhile(state.writing);
  return (
    <div className="overview-foot">
      <form method="post" action="/admin/ideas/overview">
        <input type="hidden" name="radar" value={radar} />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" className="btn" disabled={state.writing || !state.canWrite}>
          {state.writing ? "Writing…" : state.when ? "Refresh" : "Write it now"}
        </button>
      </form>
      {state.when && (
        <span className="note" data-old={!state.fresh || undefined}>
          Written {state.when}
        </span>
      )}
      {state.lastRun && (
        <span className={state.lastRun.failed ? "note failed" : "note"}>
          {state.lastRun.text} <a href={state.lastRun.href}>See the run</a>
        </span>
      )}
    </div>
  );
}

function Problems({ problems, withCategory }: { problems: ProblemItem[]; withCategory?: boolean }) {
  return (
    <ol className="problems">
      {problems.map((p) => (
        <li key={p.id}>
          <Link to="/ideas/$id" params={{ id: String(p.id) }} className="problem-row">
            <span className="problem-main">
              <span className="problem-name">
                {p.status === "starred" && <span className="star" role="img" aria-label="Starred">★ </span>}
                {p.name}
              </span>
              <span className="problem-summary">{p.summary}</span>
              <span className="problem-meta">
                {withCategory && <span>{p.category}</span>}
                {evidence(p).map((e) => (
                  <span key={String(e)}>{e}</span>
                ))}
                <span>last {p.last}</span>
              </span>
            </span>
            <span className="problem-side">
              <span className="badges">
                <VerdictBadge verdict={p.verdict} />
                <TrendBadge trend={p.trend} />
              </span>
              <Weeks weeks={p.weeks} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
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
    ...(p.task === "ideas" ? [["Paid jobs", p.jobs || "none"] as [string, string | number]] : []),
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
