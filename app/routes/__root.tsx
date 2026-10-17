/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute, useMatches } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import css from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#f2f2f0" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "pergent" },
      { title: "pergent" },
    ],
    links: [
      { rel: "stylesheet", href: css },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: Document,
  component: Outlet,
  notFoundComponent: () => <Message text="Not found." />,
  errorComponent: ({ error }) => <Message text={`Something went wrong: ${error instanceof Error ? error.message : String(error)}`} />,
});

function Document({ children }: { children: ReactNode }) {
  // The page's language is the task's (news is Turkish); a page without one is English.
  const lang = useMatches({ select: (matches) => matches.map((m) => (m.loaderData as { lang?: string } | undefined)?.lang).findLast(Boolean) ?? "en" });
  useEffect(() => {
    if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker failed:", err));
    }
  }, []);
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="page">
      <p className="note">
        {text} <a href="/read">Back to the paper</a>
      </p>
    </div>
  );
}
