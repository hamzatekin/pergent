import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Every page carries the model's markdown as HTML, unsanitized. The CSP keeps a script in it (a prompt
// injection through a headline, say) from running: scripts and styles only from this site or with this
// request's nonce, which the router puts on the hydration scripts it writes (router.tsx). Images come
// from anywhere over https.
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const result = await next({ context: { nonce } });
  const headers = new Headers(result.response.headers);
  headers.set(
    "content-security-policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  const { status, statusText, body } = result.response;
  return { ...result, response: new Response(body, { status, statusText, headers }) };
});

export const startInstance = createStart(() => ({
  // The CSRF check Start applies to server function calls by default, kept now that there is a list.
  requestMiddleware: [createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" }), securityHeaders],
}));
