import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { Beds, Epc, HomeItem, HomesPage, Sort } from "../server/homes.functions.ts";
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
  ["fit", "Best score"],
  ["rent", "Cheapest"],
  ["allin", "Cheapest all in"],
  ["near", "Shortest commute"],
  ["new", "Newest"],
];

// The rental search (tasks/homes): what matches the reader by default, or every listing up now, with
// chips for the bedrooms, the EPC, the postcode district and the things Rightmove cannot filter on,
// then the listings, best fit first, each linking to its listing on Rightmove or OpenRent, with a Hide
// button for one the reader is not interested in (the Hidden chip lists those, to undo).
export function HomesBoard({ data }: { data: HomesPage }) {
  const s = data.search;
  const all = s.view === "all";
  const hiddenView = s.view === "hidden";
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
        Rightmove and OpenRent rentals within 5 miles of NG1 up to £1,100, collected every hour
        {data.lastRun ? `, last ${data.lastRun}` : ""}. A match is at most £{m.rent.toLocaleString("en-GB")} a month (£
        {m.rentWithBills.toLocaleString("en-GB")} with every bill included), {m.minBeds} to {m.maxBeds} bedrooms, EPC {m.epc} or better
        {data.limits.length ? `, and at most ${data.limits.join(" and ")} by bus or tram` : ""}.
        {data.unread + data.noPage > 0 && ` ${data.unread + data.noPage} listings are not read yet, so they have no EPC or score and cannot match.`}
        {data.folded > 0 && ` ${data.folded} listed by a second agent ${data.folded === 1 ? "shows" : "show"} in the first one's row.`}
        {data.now && ` Compared with ${data.now}.`}
      </p>
      <nav className="feed-chips">
        <Link to="/homes" search={{ ...s, view: undefined, epc: undefined, more: undefined }} className="chip" data-active={!s.view}>
          Matches <span className="chip-count">{data.matching}</span>
        </Link>
        <Link to="/homes" search={{ ...s, view: "all", more: undefined }} className="chip" data-active={all}>
          All <span className="chip-count">{data.up}</span>
        </Link>
        {(data.hidden > 0 || hiddenView) && (
          <Link to="/homes" search={{ ...s, view: "hidden", more: undefined }} className="chip" data-active={hiddenView}>
            Hidden <span className="chip-count">{data.hidden}</span>
          </Link>
        )}
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
        {s.view && (
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
          Score {data.good}+
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
            // Keyed by the view too: a row folded on one list must not stay folded on the other.
            <HomeLine key={`${s.view ?? ""}:${h.id}`} h={h} hiddenView={hiddenView} />
          ))}
        </ol>
      ) : (
        <p className="callout">
          {hiddenView && !data.hidden
            ? "Nothing hidden. A listing you hide leaves the lists and shows here, to put back."
            : data.up || hiddenView
              ? "No listing matches these filters."
              : "Nothing collected yet. The collector runs every hour from 07:20."}
        </p>
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

function HomeLine({ h, hiddenView }: { h: HomeItem; hiddenView: boolean }) {
  // Hidden just now (or, on the Hidden list, put back): the row folds into one line with an Undo until
  // the list loads again.
  const [moved, setMoved] = useState(false);
  if (moved)
    return (
      <li className="home-moved">
        <span>
          {hiddenView ? "Back in the list" : "Hidden"}: {h.rent}, {h.title}, {h.address}
        </span>
        <HideButton id={h.id} hide={hiddenView} label="Undo" onDone={() => setMoved(false)} />
      </li>
    );
  return (
    <li>
      <div className="home-wrap">
        <a href={h.url} target="_blank" rel="noopener noreferrer" className="home-row">
          {h.image ? <img className="home-img" src={h.image} alt="" loading="lazy" width={160} height={107} /> : <span className="home-img" />}
          <span className="home-main">
            <span className="home-title">
              <span className="home-rent">{h.rent}</span>
              {h.was && <span className="home-was">was {h.was}</span>}
              <span>{[h.title, ...h.size].join(" · ")}</span>
              {h.isNew && (
                <span className="trend" data-trend="new">
                  New
                </span>
              )}
            </span>
            <span className="home-address">{h.address}</span>
            {h.key.length > 0 && (
              <span className="home-key">
                {h.key.map((k) => (
                  <span key={k.text} data-bad={k.bad || undefined}>
                    {k.text}
                  </span>
                ))}
              </span>
            )}
            {h.allIn && (
              <span className="home-allin" title={h.allIn.title}>
                <span className="home-allin-head">{h.allIn.head}</span>
                {h.allIn.parts && <span>{h.allIn.parts}</span>}
              </span>
            )}
            {h.flags.length > 0 && <span className="home-flags">{h.flags.join(" · ")}</span>}
          </span>
          <span className="home-side">
            <span
              className="epc"
              data-band={h.epc?.band ?? "none"}
              title={
                !h.epc
                  ? "Not read yet, or the listing gives no EPC"
                  : h.epc.score
                    ? `From the ${h.epc.from === "chart" ? "EPC chart" : "listing's text"}`
                    : "The listing gives only the letter, not the number, and the EPC register cannot tell which certificate at its postcode is this home's; scored as the middle of the band"
              }
            >
              {h.epc ? `EPC ${h.epc.band}${h.epc.score ? ` ${h.epc.score}` : ""}` : "EPC ?"}
            </span>
            {h.score && (
              <span className="fit" data-good={h.score.good || undefined} title={h.score.parts}>
                {h.score.label}
              </span>
            )}
          </span>
        </a>
        <HideButton id={h.id} hide={!hiddenView} label={hiddenView ? "Unhide" : "Hide"} onDone={() => setMoved(true)} />
      </div>
      <More h={h} />
      <Also label="Also listed by" copies={h.also.filter((o) => o.sure)} />
      <Also label="Maybe also listed by" copies={h.also.filter((o) => !o.sure)} />
    </li>
  );
}

// The rest of what is known about a listing, under the row and outside its link, closed: the model's note,
// how the score is made up, the other commute places, the crime and the rent against listings like it and
// the reader's home now, the other facts, and the agent.
function More({ h }: { h: HomeItem }) {
  return (
    <details className="home-more">
      <summary>
        <span className="more-more">More</span>
        <span className="more-less">Less</span>
      </summary>
      <div className="home-more-body">
        {h.fitWhy && <p className="job-why">{h.fitWhy}</p>}
        {h.photos && <p className="home-compare">Photos: {h.photos}</p>}
        {h.score && <p className="home-score">{h.score.parts}</p>}
        {h.commute.length > 0 && (
          <p className="home-commute">
            {h.commute.map((c, i) => (
              <span key={c.name}>
                {i > 0 && " · "}
                <span data-over={c.over || undefined}>{c.text}</span>
              </span>
            ))}
          </p>
        )}
        {h.crime && (
          <p className="home-crime" data-high={h.crime.high || undefined}>
            {h.crime.text}
          </p>
        )}
        {h.vsArea && <p className="home-compare">{h.vsArea}</p>}
        {h.vsNow && <p className="home-compare">{h.vsNow}</p>}
        {h.facts.length > 0 && (
          <p className="job-skills">
            {h.facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </p>
        )}
        <p className="job-meta">
          <span>{h.agent}</span>
          {h.phone && <span>{h.phone}</span>}
          <span>
            {h.market}, listed {h.listed}
          </span>
        </p>
      </div>
    </details>
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

// Hide (not interested) or put back a listing, posting to /admin/homes. With the script it posts in
// place and the row folds (`onDone`); without it the form posts and the server sends this page back.
function HideButton({ id, hide, label, onDone }: { id: string; hide: boolean; label: string; onDone: () => void }) {
  const router = useRouter();
  const back = useLocation({ select: (l) => l.href });
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <form
      method="post"
      action="/admin/homes"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = new FormData(e.currentTarget);
        setState("busy");
        try {
          const res = await fetch("/admin/homes", { method: "POST", body, headers: { accept: "application/json" } });
          if (!((await res.json()) as { ok: boolean }).ok) throw new Error("not changed");
          setState("idle");
          // A list preloaded before this (a chip hovered) would still have the row in its old place.
          router.clearCache();
          onDone();
        } catch {
          setState("failed");
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={hide ? "hide" : "show"} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        className="home-hide"
        disabled={state === "busy"}
        data-failed={state === "failed" || undefined}
        title={state === "failed" ? "Not changed, try again" : hide ? "Not interested: take it off the lists" : "Put it back on the lists"}
      >
        {state === "failed" ? "Retry" : label}
      </button>
    </form>
  );
}
