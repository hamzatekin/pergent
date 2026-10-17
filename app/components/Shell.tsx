import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Nav } from "../server/nav.ts";
import { Icon } from "./Icon.tsx";
import { Topbar } from "./Topbar.tsx";

const SCHEDULER: Record<Nav["scheduler"], string> = { on: "Scheduler on", paused: "Scheduler paused", off: "Scheduler off" };

// Every page's frame: a sidebar from md up (the briefings, the dashboard, the scheduler's state), and
// on a phone the same links as a row in the top bar instead. `header` is the bar's own row: the page's
// title on the left, its actions on the right. `active` is a task name, "newsletters" or "admin".
export function Shell({ nav, active, header, children }: { nav: Nav; active: string; header: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/read" className="brand">
          <img src="/icon.svg" alt="" />
          pergent
        </a>
        <p className="nav-label">Briefings</p>
        <nav className="nav">
          {nav.tabs.map((t) => (
            <Link key={t.name} to="/read/{-$task}/{-$runId}" params={{ task: t.name, runId: undefined }} className="nav-item" data-active={t.name === active}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ))}
          {nav.newsletters && (
            <Link to="/newsletters/{-$feed}" params={{ feed: undefined }} className="nav-item" data-active={active === "newsletters"}>
              <Icon name="mail" />
              Newsletters
            </Link>
          )}
        </nav>
        {nav.admin && (
          <>
            <p className="nav-label">Admin</p>
            <nav className="nav">
              <Link to="/admin" className="nav-item" data-active={active === "admin"}>
                <Icon name="activity" />
                Runs
              </Link>
            </nav>
          </>
        )}
        <p className="sidebar-foot" data-state={nav.scheduler}>
          <span className="dot" />
          {SCHEDULER[nav.scheduler]}
        </p>
      </aside>
      <div className="main">
        <Topbar hides>
          <nav className="mtabs">
            {nav.tabs.map((t) => (
              <Link key={t.name} to="/read/{-$task}/{-$runId}" params={{ task: t.name, runId: undefined }} className="mtab" data-active={t.name === active}>
                {t.label}
              </Link>
            ))}
            {nav.newsletters && (
              <Link to="/newsletters/{-$feed}" params={{ feed: undefined }} className="mtab" data-active={active === "newsletters"}>
                Newsletters
              </Link>
            )}
            {nav.admin && (
              <Link to="/admin" className="mtab" data-active={active === "admin"}>
                Runs
              </Link>
            )}
          </nav>
          <div className="mainbar-row">{header}</div>
        </Topbar>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
