import { Link } from "@tanstack/react-router";
import type { Beds, Epc, HomeItem, HomesPage, HomesSearch, Sort } from "../server/homes.functions.ts";
import { Shell } from "./Shell.tsx";

const BEDS: [Beds, string][] = [
  ["0", "Studio"],
  ["1", "1 bed"],
  ["2", "2 bed"],
  ["3", "3+ bed"],
];
const EPC: [Exclude<Epc, "any">, string][] = [
  ["good", "EPC A–C"],
  ["unknown", "EPC unknown"],
  ["poor", "EPC D–G"],
];
const SORT: [Sort, string][] = [
  ["fit", "Best fit"],
  ["rent", "Cheapest"],
  ["allin", "Cheapest all in"],
  ["near", "Shortest commute"],
  ["new", "Newest"],
];

// The rental search (tasks/homes): what matches the reader by default, or every listing up now, with
// chips for the bedrooms, the EPC, the postcode district and the things Rightmove cannot filter on,
// then the listings, best fit first, each linking to Rightmove.
export function HomesBoard({ data }: { data: HomesPage }) {
  const s = data.search;
  const all = s.view === "all";
  const m = data.match;
  const toggle = (key: "bills" | "fit" | "fresh" | "reduced" | "safer") => ({ ...s, [key]: s[key] ? undefined : true, more: undefined });
  const header = (
    <>
      <h1 className="crumb">
        <span className="crumb-task">Homes</span>
      </h1>
      <span className="note">
        {data.matching} {data.matching === 1 ? "match" : "matches"} · {data.up.toLocaleString("en-GB")} up
      </span>
    </>
  );
  return (
    <Shell nav={data.nav} active="homes" header={header}>
      <p className="note feed-note">
        Rightmove rentals within 5 miles of NG1 up to £1,100, collected every hour
        {data.lastRun ? `, last ${data.lastRun}` : ""}. A match is at most £{m.rent.toLocaleString("en-GB")} a month (£
        {m.rentWithBills.toLocaleString("en-GB")} with every bill included), {m.minBeds} to {m.maxBeds} bedrooms, EPC {m.epc} or better
        {data.limits.length ? `, and at most ${data.limits.join(" and ")} by bus or tram` : ""}.
        {data.unread + data.noPage > 0 && ` ${data.unread + data.noPage} listings are not read yet, so they have no EPC or fit and cannot match.`}
        {data.folded > 0 && ` ${data.folded} listed by a second agent ${data.folded === 1 ? "shows" : "show"} in the first one's row.`}
        {data.now && ` Compared with ${data.now}.`}
      </p>
      <nav className="feed-chips">
        <Link to="/homes" search={{ ...s, view: undefined, epc: undefined, more: undefined }} className="chip" data-active={!all}>
          Matches <span className="chip-count">{data.matching}</span>
        </Link>
        <Link to="/homes" search={{ ...s, view: "all", more: undefined }} className="chip" data-active={all}>
          All <span className="chip-count">{data.up}</span>
        </Link>
        <span className="chips-gap" />
        {SORT.map(([key, label]) => (
          <Link key={key} to="/homes" search={{ ...s, sort: key === "fit" ? undefined : key }} className="chip" data-active={(s.sort ?? "fit") === key}>
            {label}
          </Link>
        ))}
      </nav>
      <nav className="feed-chips">
        <Link to="/homes" search={{ ...s, beds: undefined, more: undefined }} className="chip" data-active={!s.beds}>
          Any size
        </Link>
        {BEDS.map(([key, label]) => (
          <Link key={key} to="/homes" search={{ ...s, beds: key, more: undefined }} className="chip" data-active={s.beds === key}>
            {label} <span className="chip-count">{data.counts.beds[key]}</span>
          </Link>
        ))}
        {all && (
          <>
            <span className="chips-gap" />
            <Link to="/homes" search={{ ...s, epc: undefined, more: undefined }} className="chip" data-active={!s.epc}>
              Any EPC
            </Link>
            {EPC.map(([key, label]) => (
              <Link key={key} to="/homes" search={{ ...s, epc: key, more: undefined }} className="chip" data-active={s.epc === key}>
                {label} <span className="chip-count">{data.counts.epc[key]}</span>
              </Link>
            ))}
          </>
        )}
      </nav>
      <nav className="feed-chips">
        <Link to="/homes" search={toggle("bills")} className="chip" data-active={!!s.bills}>
          Bills included
        </Link>
        <Link to="/homes" search={toggle("fit")} className="chip" data-active={!!s.fit}>
          Good fit
        </Link>
        <Link to="/homes" search={toggle("fresh")} className="chip" data-active={!!s.fresh}>
          New this week
        </Link>
        <Link to="/homes" search={toggle("reduced")} className="chip" data-active={!!s.reduced}>
          Reduced
        </Link>
        <Link to="/homes" search={toggle("safer")} className="chip" data-active={!!s.safer}>
          Lower crime
        </Link>
      </nav>
      {data.areas.length > 1 && (
        <nav className="feed-chips scroll">
          <Link to="/homes" search={{ ...s, area: undefined, more: undefined }} className="chip" data-active={!s.area}>
            Anywhere
          </Link>
          {data.areas.map((a) => (
            <Link key={a.area} to="/homes" search={{ ...s, area: a.area, more: undefined }} className="chip" data-active={s.area === a.area}>
              {a.area} <span className="chip-count">{a.count}</span>
            </Link>
          ))}
        </nav>
      )}
      {data.homes.length ? (
        <ol className="homes">
          {data.homes.map((h) => (
            <HomeLine key={h.id} h={h} />
          ))}
        </ol>
      ) : (
        <p className="callout">{data.up ? "No listing matches these filters." : "Nothing collected yet. The collector runs every hour from 07:20."}</p>
      )}
      {data.shown > data.homes.length && (
        <p className="note more">
          Showing {data.homes.length} of {data.shown}.{" "}
          <Link to="/homes" search={{ ...s, more: true }}>
            Show all
          </Link>
        </p>
      )}
    </Shell>
  );
}

function HomeLine({ h }: { h: HomeItem }) {
  return (
    <li>
      <a href={h.url} target="_blank" rel="noopener noreferrer" className="home-row">
        {h.image ? <img className="home-img" src={h.image} alt="" loading="lazy" width={160} height={107} /> : <span className="home-img" />}
        <span className="home-main">
          <span className="home-title">
            <span className="home-rent">{h.rent}</span>
            {h.was && <span className="home-was">was {h.was}</span>}
            <span>{h.title}</span>
            {h.isNew && (
              <span className="trend" data-trend="new">
                New
              </span>
            )}
          </span>
          <span className="home-address">{h.address}</span>
          {h.commute.length > 0 && (
            <span className="home-commute">
              {h.commute.map((c, i) => (
                <span key={c.name}>
                  {i > 0 && " · "}
                  <span data-over={c.over || undefined}>{c.text}</span>
                </span>
              ))}
            </span>
          )}
          {h.allIn && (
            <span className="home-allin" title={h.allIn.title}>
              {h.allIn.text}
            </span>
          )}
          {h.vsArea && <span className="home-compare">{h.vsArea}</span>}
          {h.crime && (
            <span className="home-crime" data-high={h.crime.high || undefined}>
              {h.crime.text}
            </span>
          )}
          {h.vsNow && <span className="home-compare">{h.vsNow}</span>}
          {h.fitWhy && <span className="job-why">{h.fitWhy}</span>}
          {h.facts.length > 0 && (
            <span className="job-skills">
              {h.facts.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </span>
          )}
          {h.flags.length > 0 && <span className="home-flags">{h.flags.join(" · ")}</span>}
          <span className="job-meta">
            <span>{h.agent}</span>
            {h.phone && <span>{h.phone}</span>}
            <span>
              {h.market}, listed {h.listed}
            </span>
          </span>
        </span>
        <span className="home-side">
          <span className="epc" data-band={h.epc?.band ?? "none"} title={h.epc ? `From the ${h.epc.from === "chart" ? "EPC chart" : "listing's text"}` : "Not read yet, or the listing gives no EPC"}>
            {h.epc ? `EPC ${h.epc.band}${h.epc.score ? ` ${h.epc.score}` : ""}` : "EPC ?"}
          </span>
          {h.fit && (
            <span className="fit" data-fit={h.fit} title={h.fitWhy}>
              Fit {h.fit}/5
            </span>
          )}
        </span>
      </a>
      <Also label="Also listed by" copies={h.also.filter((o) => o.sure)} />
      <Also label="Maybe also listed by" copies={h.also.filter((o) => !o.sure)} />
    </li>
  );
}

// The same home from other agents, under the row and outside its link: "Also listed by" when sure,
// "Maybe also listed by" when only its EPC score or size agrees (src/compare.ts duplicates).
function Also({ label, copies }: { label: string; copies: HomeItem["also"] }) {
  if (!copies.length) return null;
  return (
    <p className="home-also">
      {label}{" "}
      {copies.map((o, i) => (
        <span key={o.url}>
          {i > 0 && ", "}
          <a href={o.url} target="_blank" rel="noopener noreferrer">
            {o.agent} at {o.rent}
          </a>
        </span>
      ))}
    </p>
  );
}
