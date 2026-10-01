import type { ExecutionContext, ExportedHandler, MessageBatch, ScheduledController } from "@cloudflare/workers-types";
import * as Sentry from "@sentry/cloudflare";
import { Effect } from "effect";
import { createRequestHandler, RouterContextProvider } from "react-router";
import type { Env, JudgmentJob } from "../app/.server/cloudflare/env";
import { handleQueueBatch } from "../app/.server/cloudflare/jobs";
import { backfillIcons, backfillSiteProfiles, runMaintenance } from "../app/.server/flows/maintenance";
import { flushTelemetry } from "../app/.server/observability";
import { reportServerError } from "../app/.server/report";
import { runtime } from "../app/.server/runtime";
import { proxyPostHog } from "./posthog-proxy";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * Pages live on one address: www and the old workers.dev host redirect to
 * PUBLIC_URL. API routes (the payment webhook) are never redirected, since
 * webhook senders don't follow redirects.
 */
const canonicalRedirect = (request: Request, env: Env): Response | undefined => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) return undefined;
  const publicUrl = typeof env["PUBLIC_URL"] === "string" ? env["PUBLIC_URL"] : undefined;
  const canonical = publicUrl ? new URL(publicUrl) : undefined;
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.href, 301);
  }
  if (canonical && url.hostname.endsWith(".workers.dev") && url.hostname !== canonical.hostname) {
    return Response.redirect(new URL(url.pathname + url.search, canonical).href, 301);
  }
  return undefined;
};

/** Sends buffered spans and analytics once the work is done (never throws). */
const flush = (): Promise<void> => runtime.runPromise(flushTelemetry).catch(() => undefined);

/**
 * The Ranked by Jev Worker:
 * - fetch: React Router (loaders/actions run Effect programs on the shared runtime)
 * - queue: paid judgments (crawl + verdict) and serialized placements
 * - scheduled: every-minute maintenance (payment sweeper, stalled-job recovery, refunds,
 *   homepage profiles and logo copies for older entries)
 */
const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const proxied = proxyPostHog(request, env);
    if (proxied) return proxied;
    const response = canonicalRedirect(request, env) ?? (await requestHandler(request, new RouterContextProvider()));
    ctx.waitUntil(flush());
    return response;
  },

  async queue(batch: MessageBatch<JudgmentJob>, _env: Env, ctx: ExecutionContext) {
    await runtime.runPromise(handleQueueBatch(batch));
    ctx.waitUntil(flush());
  },

  scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    // Each runs independently: a failing crawl never holds up payments or refunds.
    ctx.waitUntil(
      Promise.allSettled([
        runtime.runPromise(runMaintenance),
        // Profiles first: an older entry's icon address comes from its profile.
        runtime.runPromise(Effect.andThen(backfillSiteProfiles, backfillIcons)),
      ])
        .then((results) => {
          for (const result of results) if (result.status === "rejected") reportServerError(result.reason, { cron: "maintenance" });
        })
        .finally(flush),
    );
  },
};

/**
 * Errors to Sentry (server side; the browser reports its own, see
 * app/entry.client.tsx). Without SENTRY_DSN it stays off. No tracing: that's
 * PostHog's job.
 */
export default Sentry.withSentry(
  (env: Env) =>
    typeof env.SENTRY_DSN === "string" && env.SENTRY_DSN !== ""
      ? {
          dsn: env.SENTRY_DSN,
          environment: typeof env["PUBLIC_URL"] === "string" ? "production" : "development",
          tracesSampleRate: 0,
          // Errors only: no cookies (the visitor id), headers, bodies or user info.
          dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
        }
      : undefined,
  handler as unknown as ExportedHandler<Env>,
);
