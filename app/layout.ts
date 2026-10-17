// The reader's choice of layout for a task that has the printed newspaper one (task.json `newspaper`):
// a cookie rather than the URL, so the choice stays across runs, tabs and visits. The toggle
// (components/LayoutToggle.tsx) sets it, through app/routes/layout.ts before the page hydrates, and
// getPaperPage reads it.
export const LAYOUT_COOKIE = "pergent_layout";
export type Layout = "cards" | "newspaper";
export const layoutCookie = (layout: Layout) => `${LAYOUT_COOKIE}=${layout}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax`;
