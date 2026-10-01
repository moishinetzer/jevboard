/**
 * Pages live on one address: plain http, www and the old workers.dev host all
 * redirect to PUBLIC_URL. API routes (the payment webhook) are never
 * redirected, since webhook senders don't follow redirects.
 */
export const canonicalRedirect = (request: Request, publicUrl: string | undefined): Response | undefined => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) return undefined;
  const canonical = publicUrl ? new URL(publicUrl) : undefined;
  if (canonical && url.hostname.endsWith(".workers.dev") && url.hostname !== canonical.hostname) {
    return Response.redirect(new URL(url.pathname + url.search, canonical).href, 301);
  }
  const target = new URL(url);
  if (target.hostname.startsWith("www.")) target.hostname = target.hostname.slice(4);
  // A bare domain in a post or an address bar often starts as http: over it the visitor's cookie
  // isn't kept and checkout would return to an insecure page.
  if (canonical?.protocol === "https:" && target.protocol === "http:" && target.hostname === canonical.hostname) target.protocol = "https:";
  return target.href === url.href ? undefined : Response.redirect(target.href, 301);
};
