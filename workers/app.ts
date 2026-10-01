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
import { canonicalRedirect } from "./canonical";
import { proxyPostHog } from "./posthog-proxy";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

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
    const publicUrl = typeof env["PUBLIC_URL"] === "string" ? env["PUBLIC_URL"] : undefined;
    const response = canonicalRedirect(request, publicUrl) ?? (await requestHandler(request, new RouterContextProvider()));
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
