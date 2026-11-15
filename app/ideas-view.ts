// The Ideas page's three views of a radar's board (components/Ideas.tsx): the brief (the answer first,
// then a ranked list), the map (judged problems placed by demand and by how winnable they are) and the
// board (a column per stage). `?view=` picks one; without it, the reader's default, kept in a cookie for
// a year so the page is rendered in it on the server, else the brief. The page's Make default button
// sets the cookie in the browser.
export type IdeasView = "brief" | "map" | "board";
export const IDEAS_VIEWS: { view: IdeasView; label: string }[] = [
  { view: "brief", label: "Brief" },
  { view: "map", label: "Map" },
  { view: "board", label: "Board" },
];
export const ideasViewCookieName = "pergent_ideas_view";
export const ideasViewCookie = (view: IdeasView) => `${ideasViewCookieName}=${view}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax`;
export const isIdeasView = (value: unknown): value is IdeasView => value === "brief" || value === "map" || value === "board";

// Where a form on the page sends the reader back to: /ideas with the radar, category and view it came
// from, each kept only when it is a plain slug (a view only when it is one), so no form can send the
// reader anywhere else.
export function ideasPath(form: FormData, keys: ("radar" | "category" | "view")[] = ["radar", "category", "view"]): string {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = String(form.get(key) ?? "");
    if (key === "view" ? isIdeasView(value) : /^[a-z0-9-]+$/.test(value)) query.set(key, value);
  }
  const q = query.toString();
  return `/ideas${q ? `?${q}` : ""}`;
}
