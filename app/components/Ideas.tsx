import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { BriefState, BriefView, BriefsPage, IdeasPage, ProblemItem, ProblemPage } from "../server/ideas.functions.ts";
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

// The radar's board: the problems found in what small business owners post, counted by code, the ones
// most people raised first. Category chips filter it; by default a problem only one person raised is
// left out until someone else does.
export function IdeasBoard({ data }: { data: IdeasPage }) {
  const { totals } = data;
  const category = data.categories.find((c) => c.slug === data.category);
  const header = (
    <>
      <h1 className="crumb">
        <span className="crumb-task">Ideas</span>
        {category && <span className="stamp">{category.name}</span>}
      </h1>
      <a href="/admin/mutes/ideas" className="linkbtn">
        Never show{data.muted ? ` (${data.muted} hidden)` : ""}
      </a>
    </>
  );
  return (
    <Shell nav={data.nav} active="ideas" header={header}>
      <BriefPanel state={data.brief} />
      <Sources sources={data.sources} />
      <p className="note feed-note">
        {totals.posts.toLocaleString("en-GB")} posts collected, {totals.sorted.toLocaleString("en-GB")} sorted into {plural(totals.problems, "problem")}
        {data.lastSort ? `, last sorted ${data.lastSort}` : ""}.{totals.waiting > 0 && ` ${totals.waiting.toLocaleString("en-GB")} waiting for the next sorts.`}
      </p>
      <nav className="feed-chips">
        <Link to="/ideas" search={{ all: data.all || undefined, show: data.show }} className="chip" data-active={!data.category}>
          All
        </Link>
        {data.categories
          .filter((c) => c.count > 0 || c.slug === data.category)
          .map((c) => (
            <Link key={c.slug} to="/ideas" search={{ category: c.slug, all: data.all || undefined, show: data.show }} className="chip" data-active={c.slug === data.category}>
              {c.name}
              <span className="chip-count">{c.count}</span>
            </Link>
          ))}
      </nav>
      <nav className="feed-chips">
        <Link to="/ideas" search={{ category: data.category, all: data.all || undefined }} className="chip" data-active={!data.show}>
          Everything
        </Link>
        {data.shows
          .filter((s) => s.count > 0 || s.show === data.show)
          .map((s) => (
            <Link key={s.show} to="/ideas" search={{ category: data.category, all: data.all || undefined, show: s.show }} className="chip" data-active={s.show === data.show}>
              {s.label}
              <span className="chip-count">{s.count}</span>
            </Link>
          ))}
      </nav>
      {data.problems.length > 0 ? (
        <ol className="problems">
          {data.problems.map((p) => (
            <li key={p.id}>
              <Link to="/ideas/$id" params={{ id: String(p.id) }} className="problem-row">
                <span className="problem-main">
                  <span className="problem-name">
                    {p.status === "starred" && <span className="star" aria-label="Starred">★ </span>}
                    {p.name}
                  </span>
                  <span className="problem-summary">{p.summary}</span>
                  <span className="problem-meta">
                    {!data.category && <span>{p.category}</span>}
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
      ) : (
        <p className="callout">
          {totals.sorted === 0 ? "Nothing sorted yet. The radar sorts new posts every 3 hours." : data.all ? "No problems here yet." : "No problem here has been raised by more than one person yet."}
        </p>
      )}
      {(data.oneOffs > 0 || data.all) && (
        <p className="note more">
          {data.all ? (
            <Link to="/ideas" search={{ category: data.category, show: data.show }}>
              Only problems more than one person raised
            </Link>
          ) : (
            <Link to="/ideas" search={{ category: data.category, all: true, show: data.show }}>
              Show {plural(data.oneOffs, "problem")} only one person raised so far
            </Link>
          )}
        </p>
      )}
    </Shell>
  );
}

// One problem: its counts, its weeks, and every post that raised it, each with what the sort read in it.
export function ProblemView({ data }: { data: ProblemPage }) {
  const { problem: p } = data;
  const header = (
    <h1 className="crumb">
      <Link to="/ideas" className="crumb-task">
        Ideas
      </Link>
      <span className="stamp">{p.category}</span>
    </h1>
  );
  const budgets = [...new Set(p.budgets)];
  const facts: [string, string | number, boolean?][] = [
    ["People", p.people],
    ["Mentions", p.mentions],
    ["Sources", p.sources.join(", ")],
    ["Paid jobs", p.jobs || "none"],
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
            {p.status === "starred" && <span className="star" aria-label="Starred">★ </span>}
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
            <li key={m.url} className="mention">
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
        {data.overBar
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

// While a brief is being written the page asks the server again every 5s, so it appears without a reload.
function useRefreshWhile(busy: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.invalidate(), 5_000);
    return () => clearInterval(timer);
  }, [busy, router]);
}

function BriefMe({ state, label = "Brief me" }: { state: BriefState; label?: string }) {
  if (!state.canBrief) return null;
  return (
    <form method="post" action="/admin/ideas/brief">
      <button type="submit" className="btn primary" disabled={state.briefing}>
        {state.briefing ? "Writing your brief…" : label}
      </button>
    </form>
  );
}

// The top of the board: the newest brief (open for 12 hours, then closed to one line), with Brief me to
// write a new one covering what changed since. The briefs page keeps the earlier ones.
function BriefPanel({ state }: { state: BriefState }) {
  useRefreshWhile(state.briefing);
  const [latest] = state.briefs;
  if (!latest)
    return (
      <div className="brief brief-empty">
        <p>Ask for a brief and the radar sums up what it found: what is worth a look, what is new or rising, which verdicts changed.</p>
        <BriefMe state={state} />
      </div>
    );
  return (
    <details className="brief" open={latest.fresh || state.briefing}>
      <summary>
        <span className="brief-title">Brief</span>
        <span className="stamp">{latest.when}</span>
      </summary>
      <BriefBody brief={latest} />
      <div className="brief-foot">
        <BriefMe state={state} label="Brief me again" />
        <Link to="/ideas/briefs" className="linkbtn">
          Earlier briefs
        </Link>
      </div>
    </details>
  );
}

function BriefBody({ brief }: { brief: BriefView }) {
  return (
    <div className="brief-body">
      <p className="brief-summary">{brief.summary}</p>
      {brief.groups.map((g) => (
        <section key={g.group} className="brief-group">
          <h4>{g.group}</h4>
          <ul>
            {g.items.map((i) => (
              <li key={i.problem}>
                <Link to="/ideas/$id" params={{ id: String(i.problem) }}>
                  {i.name}
                </Link>{" "}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {brief.next && (
        <p className="brief-next">
          <strong>Next:</strong> {brief.next}
        </p>
      )}
      <p className="note">Covers what changed since {brief.since}.</p>
    </div>
  );
}

export function BriefsList({ data }: { data: BriefsPage }) {
  useRefreshWhile(data.briefing);
  const header = (
    <>
      <h1 className="crumb">
        <Link to="/ideas" className="crumb-task">
          Ideas
        </Link>
        <span className="stamp">Briefs</span>
      </h1>
      <BriefMe state={data} />
    </>
  );
  return (
    <Shell nav={data.nav} active="ideas" header={header}>
      <div className="briefs-list">
        {data.briefs.length ? (
          data.briefs.map((b) => (
            <article key={b.id} className="brief">
              <h3 className="brief-when">{b.when}</h3>
              <BriefBody brief={b} />
            </article>
          ))
        ) : (
          <p className="callout">No briefs yet.</p>
        )}
      </div>
    </Shell>
  );
}
