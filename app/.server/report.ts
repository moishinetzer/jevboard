import * as Sentry from "@sentry/cloudflare";
import { Cause } from "effect";

/**
 * Sends a failure the app handled itself (a defect behind a 500, a queue job
 * that gave up, a cron run that crashed) to Sentry. A no-op until SENTRY_DSN
 * is set; never throws. Errors nobody caught reach Sentry through
 * `withSentry` in workers/app.ts.
 */
export const reportServerError = (error: unknown, context?: Record<string, unknown>): void => {
  try {
    const exception = Cause.isCause(error) ? Cause.squash(error) : error;
    Sentry.captureException(exception, context ? { extra: context } : undefined);
  } catch {
    // Reporting must never break the request.
  }
};
