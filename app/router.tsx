import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

// The request's CSP nonce (start.ts) on the server; in the browser the router reads it back from the
// csp-nonce meta tag the server wrote.
const nonce = createIsomorphicFn()
  .server(() => (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce)
  .client(() => undefined);

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Hovering a tab or an arrow fetches that page, so the click shows it at once.
    defaultPreload: "intent",
    ssr: { nonce: nonce() },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
