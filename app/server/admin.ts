import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie } from "@tanstack/react-start/server";
import { listTasks, loadTask } from "#src/runner.ts";

// The dashboard is behind one password, ADMIN_PASSWORD; without it /admin does not exist. The session
// cookie is an HMAC of the password, so changing the password logs everyone out. Its path is / because
// the pages load their data from /_serverFn/...; it is HttpOnly and SameSite=Strict.
export const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const COOKIE = "pergent_admin";
const token = () => createHmac("sha256", PASSWORD).update("pergent-admin").digest("hex");

export function loggedIn(): boolean {
  if (!PASSWORD) return false;
  const got = Buffer.from(getCookie(COOKIE) ?? "");
  const want = Buffer.from(token());
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordMatches(given: string): boolean {
  const a = createHmac("sha256", PASSWORD).update(given).digest();
  const b = createHmac("sha256", PASSWORD).update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

export function sessionCookie(request: Request): string {
  const secure = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  return `${COOKIE}=${token()}; Path=/; Max-Age=${30 * 86_400}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

// The cookie as the first version set it, on /admin only, is cleared too.
export const clearCookies = [`${COOKIE}=; Path=/; Max-Age=0`, `${COOKIE}=; Path=/admin; Max-Age=0`];

export const seeOther = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
};

// What every form POST under /admin goes through: no dashboard without a password, no POST from another
// site (the cookie is SameSite=Strict already; with referrer-policy no-referrer the browser sends
// `Origin: null` for our own forms, so that passes), and no change without the cookie.
export function guardPost(request: Request, { login = false } = {}): Response | null {
  if (!PASSWORD) return new Response("set ADMIN_PASSWORD to turn on the dashboard", { status: 404 });
  const origin = URL.parse(request.headers.get("origin") ?? "");
  if (origin && origin.host !== request.headers.get("host")) return new Response("bad origin", { status: 403 });
  if (!login && !loggedIn()) return seeOther("/admin/login");
  return null;
}

// Where a login returns to: only a path on this site, the dashboard's or the newsletters' (the
// newsletters send you to the login).
export const adminPath = (next: string | undefined) => (next && /^\/(admin|newsletters)(\/|$)/.test(next) ? next : "/admin");
export const backTo = (back: string, task: string) => (/^\/(read|admin)\//.test(back) ? back : `/read/${task}`);

// Whether the JSON API answers for a task: only one in tasks/. The database still holds the runs of a
// task that has been removed (the private `today`, built from the reader's notes), and those stay unread.
export async function canRead(task: string) {
  return (await listTasks()).includes(task);
}

// Only a task with `"mute": true` has a never-show list (src/mute.ts).
export async function hasMuteList(task: string) {
  return (await listTasks()).includes(task) && (await loadTask(task).then((t) => !!t.config.mute, () => false));
}
