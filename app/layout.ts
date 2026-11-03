// The reader's choice of layout for a task that has the printed newspaper one (task.json `newspaper`):
// the cards ("columns"), plain rows (one story per row, stacked) or the newspaper, kept per task in a cookie rather than the URL, so the choice
// stays across runs and visits and News can stay printed while Tech is in columns. The toggle
// (components/LayoutToggle.tsx) sets it, through app/routes/layout.ts before the page hydrates, and
// getPaperPage reads it; without one, the task's `layout` decides, else the newspaper.
export type Layout = "cards" | "rows" | "newspaper";
export const layoutCookieName = (task: string) => `pergent_layout_${task}`;
export const layoutCookie = (task: string, layout: Layout) => `${layoutCookieName(task)}=${layout}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax`;
export const isLayout = (value: unknown): value is Layout => value === "cards" || value === "rows" || value === "newspaper";
