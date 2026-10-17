// Dates and times are formatted on the server, so the page hydrates with the same text it was
// rendered with whatever the browser's zone.
export function formatDate(iso: string, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleString("en-GB", { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleString("en-GB", opts);
  }
}

export const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

export function ago(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

export function formatDay(iso: string, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  try {
    return new Date(iso).toLocaleDateString("en-GB", { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleDateString("en-GB", opts);
  }
}
