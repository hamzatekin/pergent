import { createServerFn } from "@tanstack/react-start";
import { nav, type Nav } from "./nav.ts";

// The sidebar for pages that load nothing else from the runner (the dashboard's layout).
export const getNav = createServerFn({ method: "GET" }).handler(async (): Promise<Nav> => {
  const { configs: _, ...rest } = await nav();
  return rest;
});
