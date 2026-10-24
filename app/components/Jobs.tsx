import { Link } from "@tanstack/react-router";
import type { Family, JobsPage, Mode, Sponsor } from "../server/jobs.functions.ts";
import { Shell } from "./Shell.tsx";

type Search = { family?: Family; sponsor?: Sponsor; mode?: Mode; pay?: true; all?: true };

const SPONSOR: Record<Sponsor, string> = { yes: "Sponsors", no: "No sponsorship" };
const MODE: Record<Mode, string> = { remote: "Remote", hybrid: "Hybrid", office: "Office" };

// The job market tracker's adverts (tasks/jobs-collect): what is open now, counted by family, by week
// and in total, then the adverts themselves, frontend first, with chips for the family, sponsorship,
// the work mode and whether a salary is given.
export function JobsBoard({ data }: { data: JobsPage }) {
  const search: Search = { family: data.family, sponsor: data.sponsor, mode: data.mode, pay: data.pay || undefined };
  const t = data.totals;
  const header = (
    <>
      <h1 className="crumb">
        <span className="crumb-task">Jobs</span>
      </h1>
      <span className="note">{data.open.toLocaleString("en-GB")} open</span>
    </>
  );
  return (
    <Shell nav={data.nav} active="jobs" header={header}>
      <p className="note feed-note">
        Software developer adverts in the UK or remote from it, collected every morning
        {data.sources.length > 0 && ` from ${data.sources.map((s) => `${s.source} (${s.count})`).join(", ")}`}
        {data.lastRun ? `, last ${data.lastRun}` : ""}.
      </p>
      {data.open === 0 ? (
        <p className="callout">Nothing collected yet. The collector runs every morning at 06:30.</p>
      ) : (
        <>
          <div className="jobs-facts">
            <dl className="stats">
              <div>
                <dt>At licensed sponsors</dt>
                <dd>{t.sponsors}%</dd>
              </div>
              <div>
                <dt>Advert says it sponsors</dt>
                <dd>{t.says}</dd>
              </div>
              <div>
                <dt>Says no sponsorship</dt>
                <dd>{t.no}</dd>
              </div>
              <div>
                <dt>Remote · hybrid · office</dt>
                <dd>
                  {t.remote}% · {t.hybrid}% · {t.office}%
                </dd>
              </div>
              <div>
                <dt>Median advertised pay</dt>
                <dd>{t.median ?? "not enough yet"}</dd>
              </div>
              <div>
                <dt>With a salary</dt>
                <dd>{t.withPay.toLocaleString("en-GB")}</dd>
              </div>
            </dl>
          </div>
          <div className="jobs-tables">
            <table className="jobs-table">
              <caption>Open adverts by role</caption>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Open</th>
                  <th>Sponsors</th>
                  <th>Remote</th>
                  <th>Median pay</th>
                </tr>
              </thead>
              <tbody>
                {data.families.map((f) => (
                  <tr key={f.family} data-active={f.family === data.family || undefined}>
                    <th>
                      <Link to="/jobs" search={{ ...search, family: f.family }}>
                        {f.label}
                      </Link>
                    </th>
                    <td>{f.open}</td>
                    <td>{f.open ? `${f.sponsors}%` : ""}</td>
                    <td>{f.open ? `${f.remote}%` : ""}</td>
                    <td>{f.median ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.weeks.length > 0 && (
              <table className="jobs-table">
                <caption>New adverts by week</caption>
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th>New</th>
                    <th>Sponsors</th>
                    <th>Remote</th>
                    <th>Frontend side</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.label}>
                      <th>
                        {w.label}
                        {w.first && <sup>*</sup>}
                      </th>
                      <td>{w.added}</td>
                      <td>{w.added ? `${w.sponsors}%` : ""}</td>
                      <td>{w.added ? `${w.remote}%` : ""}</td>
                      <td>{w.added ? `${w.frontend}%` : ""}</td>
                    </tr>
                  ))}
                </tbody>
                {data.weeks.some((w) => w.first) && (
                  <tfoot>
                    <tr>
                      <td colSpan={5}>* Collection started this week, so it holds every advert open that day.</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
          <nav className="feed-chips">
            <Link to="/jobs" search={{ ...search, family: undefined }} className="chip" data-active={!data.family}>
              All roles
            </Link>
            {data.families
              .filter((f) => f.open > 0 || f.family === data.family)
              .map((f) => (
                <Link key={f.family} to="/jobs" search={{ ...search, family: f.family }} className="chip" data-active={f.family === data.family}>
                  {f.label}
                  <span className="chip-count">{f.open}</span>
                </Link>
              ))}
          </nav>
          <nav className="feed-chips">
            <Link to="/jobs" search={{ ...search, sponsor: undefined }} className="chip" data-active={!data.sponsor}>
              Any sponsorship
            </Link>
            {(Object.keys(SPONSOR) as Sponsor[]).map((s) => (
              <Link key={s} to="/jobs" search={{ ...search, sponsor: s }} className="chip" data-active={s === data.sponsor}>
                {SPONSOR[s]}
              </Link>
            ))}
            <span className="chips-gap" />
            <Link to="/jobs" search={{ ...search, mode: undefined }} className="chip" data-active={!data.mode}>
              Anywhere
            </Link>
            {(Object.keys(MODE) as Mode[]).map((m) => (
              <Link key={m} to="/jobs" search={{ ...search, mode: m }} className="chip" data-active={m === data.mode}>
                {MODE[m]}
              </Link>
            ))}
            <span className="chips-gap" />
            <Link to="/jobs" search={{ ...search, pay: data.pay ? undefined : true }} className="chip" data-active={data.pay}>
              With a salary
            </Link>
          </nav>
          {data.jobs.length > 0 ? (
            <ol className="jobs">
              {data.jobs.map((j) => (
                <li key={j.id}>
                  <a href={j.url} target="_blank" rel="noopener noreferrer" className="job-row">
                    <span className="job-main">
                      <span className="job-title">
                        {j.title}
                        {j.isNew && <span className="trend" data-trend="new">New</span>}
                      </span>
                      <span className="job-meta">
                        <span className="job-company">{j.company}</span>
                        {j.location && <span>{j.location}</span>}
                        {j.work && !(j.work === "Remote" && j.location.startsWith("Remote")) && <span>{j.work}</span>}
                      </span>
                      <span className="job-meta">
                        <span>{j.family}</span>
                        <span>{j.source}</span>
                        <span>seen {j.seen}</span>
                      </span>
                    </span>
                    <span className="job-side">
                      {j.pay && <span className="job-pay">{j.pay}</span>}
                      {j.sponsor && (
                        <span className="sponsor" data-sponsor={j.sponsor} title={j.sponsorNote}>
                          {SPONSOR[j.sponsor]}
                        </span>
                      )}
                      {j.sponsorNote && <span className="job-note">{j.sponsorNote}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="callout">No open advert matches these filters.</p>
          )}
          {data.shown > data.jobs.length && (
            <p className="note more">
              <Link to="/jobs" search={{ ...search, all: true }}>
                Show all {data.shown.toLocaleString("en-GB")}
              </Link>
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
