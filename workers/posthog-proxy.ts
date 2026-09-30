import type { Env } from "../app/.server/cloudflare/env";

/**
 * Where the browser SDK sends everything: our own domain under a bland name,
 * since ad blockers match paths like /ingest, /analytics or /posthog.
 */
export const PROXY_PATH = "/rbj";

/**
 * Forwards `/rbj/*` to PostHog: static SDK assets to the assets host,
 * everything else (events, replays, flags) to the ingestion host. Only when a
 * PostHog token is configured; otherwise it's a normal 404 from the app.
 */
export const proxyPostHog = (request: Request, env: Env): Promise<Response> | undefined => {
  const url = new URL(request.url);
  if (url.pathname !== PROXY_PATH && !url.pathname.startsWith(`${PROXY_PATH}/`)) return undefined;
  if (typeof env["POSTHOG_TOKEN"] !== "string" || env["POSTHOG_TOKEN"] === "") return undefined;

  const ingestHost = new URL(typeof env["POSTHOG_HOST"] === "string" ? env["POSTHOG_HOST"] : "https://eu.i.posthog.com");
  const path = url.pathname.slice(PROXY_PATH.length) || "/";
  // Only the path and query are taken from the request: setting `pathname` can never
  // change the host, whereas `new URL("//evil.example/...", base)` would.
  const target = new URL(ingestHost.origin);
  target.pathname = path;
  target.search = url.search;
  if (path.startsWith("/static/")) target.hostname = ingestHost.hostname.replace(/^(\w+)\.i\./, "$1-assets.i.");
  if (target.hostname !== ingestHost.hostname && !target.hostname.endsWith(".posthog.com")) {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }

  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.set("host", target.hostname);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-forwarded-for", ip);

  return fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "manual",
  }).then((response) => {
    // PostHog never needs to set cookies on our domain.
    const safe = new Response(response.body, response);
    safe.headers.delete("set-cookie");
    return safe;
  });
};
