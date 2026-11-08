// Where a login returns to (`next`): only a path on this site, the dashboard's or one of the pages behind
// the cookie that send you to the login, with its query (/ideas?category=…), in printable ASCII (the
// gates send it encoded): a space, a control character or a raw "—" in a Location header made the
// login answer 500. Its own file because the login page's form needs it in the browser too, and
// app/server/admin.ts is server-only.
export const adminPath = (next: string | undefined) => (next && /^\/(admin|newsletters|ideas|jobs|homes)([/?][!-~]*)?$/.test(next) ? next : "/admin");
