import type { Env } from "../app/.server/cloudflare/env";

/** Where the browser SDK sends everything; served from our own domain so ad blockers leave it alone. */
export const INGEST_PATH = "/ingest";

/**
 * Forwards `/ingest/*` to PostHog: static SDK assets to the assets host,
 * everything else (events, replays, flags) to the ingestion host. Only when a
 * PostHog token is configured; otherwise it's a normal 404 from the app.
 */
export const proxyPostHog = (request: Request, env: Env): Promise<Response> | undefined => {
  const url = new URL(request.url);
  if (url.pathname !== INGEST_PATH && !url.pathname.startsWith(`${INGEST_PATH}/`)) return undefined;
  if (typeof env["POSTHOG_TOKEN"] !== "string" || env["POSTHOG_TOKEN"] === "") return undefined;

  const ingestHost = new URL(typeof env["POSTHOG_HOST"] === "string" ? env["POSTHOG_HOST"] : "https://eu.i.posthog.com");
  const path = url.pathname.slice(INGEST_PATH.length) || "/";
  const target = new URL(path + url.search, ingestHost);
  if (path.startsWith("/static/")) target.hostname = ingestHost.hostname.replace(/^(\w+)\.i\./, "$1-assets.i.");

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
  });
};
