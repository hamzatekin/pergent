import { Link } from "@tanstack/react-router";
import type { Family, JobsPage, Mode, Sponsor } from "../server/jobs.functions.ts";
import { Shell } from "./Shell.tsx";

type Search = { family?: Family; sponsor?: Sponsor; mode?: Mode; skill?: string; fit?: true; pay?: true; all?: true };

const SPONSOR: Record<Sponsor, string> = { yes: "Sponsors", no: "No sponsorship" };
const MODE: Record<Mode, string> = { remote: "Remote", hybrid: "Hybrid", office: "Office" };

// The job market tracker's adverts (tasks/jobs-collect, read by tasks/jobs-read): what is open now,
// counted by family, by skill, by week and in total, then the adverts themselves, frontend first, with
// chips for the family, sponsorship, the work mode, a skill and whether a salary is given.
export function JobsBoard({ data }: { data: JobsPage }) {
  const search: Search = { family: data.family, sponsor: data.sponsor, mode: data.mode, skill: data.skill, fit: data.fit || undefined, pay: data.pay || undefined };
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
        {data.lastRun ? `, last ${data.lastRun}` : ""}. Haiku reads each new one for its role, skills and what it says about visas
        {t.notDev > 0 && `, and set aside ${t.notDev} that ${t.notDev === 1 ? "is not a developer job" : "are not developer jobs"}`}.
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
              <div>
                <dt>Good fit for you</dt>
                <dd>{t.read ? t.good.toLocaleString("en-GB") : "none read yet"}</dd>
              </div>
              <div>
                <dt>Read by the model</dt>
                <dd>
                  {t.read.toLocaleString("en-GB")} of {data.open.toLocaleString("en-GB")}
                </dd>
              </div>
              <div>
                <dt>Expect AI coding tools</dt>
                <dd>{t.read ? `${t.aiTools}%` : "none read yet"}</dd>
              </div>
            </dl>
          </div>
          <div className="jobs-tables">
            <div className="jobs-column">
              <table className="jobs-table">
                <caption>Open adverts by role</caption>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Open</th>
                    <th>Sponsors</th>
                    <th className="wide">Remote</th>
                    <th>Median pay</th>
                    <th>In {data.home}</th>
                    <th className="wide">Good fit</th>
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
                      <td className="wide">{f.open ? `${f.remote}%` : ""}</td>
                      <td>{f.median ?? ""}</td>
                      <td>{f.atHome ?? ""}</td>
                      <td className="wide">{f.open ? f.good : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.places.length > 0 && (
                <table className="jobs-table">
                  <caption>Pay by place, and what it is worth in {data.home}</caption>
                  <thead>
                    <tr>
                      <th>Place</th>
                      <th className="wide">With pay</th>
                      <th>Median pay</th>
                      <th>Worth in {data.home}</th>
                      <th className="wide">One-bed rent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.places.map((p) => (
                      <tr key={p.place}>
                        <th>{p.place}</th>
                        <td className="wide">{p.withPay}</td>
                        <td>{p.median ?? ""}</td>
                        <td>{p.atHome ?? ""}</td>
                        <td className="wide">{p.rent}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>
                        Worth in {data.home} is the salary that leaves as much there after 2026/27 income tax and National Insurance (Scottish rates in Scotland) and a
                        month's average one-bed rent (ONS, {data.rentsMonth}). Remote jobs are taken as done from {data.home}. Pension and student loan are left out.
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
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
            {data.skills.length > 0 && (
              <table className="jobs-table">
                <caption>Most asked-for skills</caption>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Adverts</th>
                    <th>Of all read</th>
                    <th>Of frontend side</th>
                  </tr>
                </thead>
                <tbody>
                  {data.skills.map((k) => (
                    <tr key={k.skill} data-active={k.skill.toLowerCase() === data.skill?.toLowerCase() || undefined}>
                      <th>
                        <Link to="/jobs" search={{ ...search, skill: k.skill }}>
                          {k.skill}
                        </Link>
                      </th>
                      <td>{k.adverts}</td>
                      <td>{k.share}%</td>
                      <td>{k.frontSide}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Frontend side is frontend, full stack and mobile roles. Skills named only as a plus are left out.</td>
                  </tr>
                </tfoot>
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
            <Link to="/jobs" search={{ ...search, fit: data.fit ? undefined : true }} className="chip" data-active={data.fit}>
              Good fit
            </Link>
            <Link to="/jobs" search={{ ...search, pay: data.pay ? undefined : true }} className="chip" data-active={data.pay}>
              With a salary
            </Link>
            {data.skill && (
              <Link to="/jobs" search={{ ...search, skill: undefined }} className="chip" data-active title="Show every skill">
                {data.skill} ×
              </Link>
            )}
          </nav>
          {data.jobs.length > 0 ? (
            <ol className="jobs">
              {data.jobs.map((j) => (
                <li key={j.id}>
                  <a href={j.url} target="_blank" rel="noopener noreferrer" className="job-row">
                    <span className="job-main">
                      <span className="job-title">
                        {j.title}
                        {j.isNew && (
                          <span className="trend" data-trend="new">
                            New
                          </span>
                        )}
                      </span>
                      <span className="job-meta">
                        <span className="job-company">{j.company}</span>
                        {j.location && <span>{j.location}</span>}
                        {j.work && !(j.work === "Remote" && j.location.startsWith("Remote")) && <span>{j.work}</span>}
                      </span>
                      <span className="job-meta">
                        <span>{j.family}</span>
                        {j.years && <span>{j.years}</span>}
                        <span>{j.source}</span>
                        <span>seen {j.seen}</span>
                      </span>
                      {j.fitWhy && <span className="job-why">{j.fitWhy}</span>}
                      {j.skills.length > 0 && (
                        <span className="job-skills">
                          {j.skills.map((k) => (
                            <span key={k}>{k}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="job-side">
                      {j.fit !== null && (
                        <span className="fit" data-fit={j.fit} title={j.fitWhy}>
                          Fit {j.fit}/5
                        </span>
                      )}
                      {j.pay && (
                        <span className="job-pay" title={j.worthNote || undefined}>
                          {j.pay}
                        </span>
                      )}
                      {j.worth && (
                        <span className="job-worth" title={j.worthNote}>
                          {j.worth}
                        </span>
                      )}
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
