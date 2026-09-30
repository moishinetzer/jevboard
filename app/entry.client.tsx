import * as Sentry from "@sentry/react";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/**
 * Browser errors to Sentry, started before hydration so nothing slips past:
 * uncaught errors, unhandled rejections, and what React reports through its
 * error hooks. The DSN comes from the page (root loader, <meta name="sentry">).
 * No session replay (PostHog has it) and no tracing.
 */
const readSentryConfig = (): { dsn: string; environment: string } | null => {
  try {
    const content = document.querySelector('meta[name="sentry"]')?.getAttribute("content");
    const config = content ? (JSON.parse(content) as { dsn?: unknown; environment?: unknown }) : null;
    return config && typeof config.dsn === "string"
      ? { dsn: config.dsn, environment: typeof config.environment === "string" ? config.environment : "production" }
      : null;
  } catch {
    return null;
  }
};

const sentry = readSentryConfig();
if (sentry) {
  Sentry.init({
    dsn: sentry.dsn,
    environment: sentry.environment,
    tracesSampleRate: 0,
    // Noise from browser extensions and old tabs, not our code.
    ignoreErrors: ["ResizeObserver loop", "Non-Error promise rejection captured", /Failed to fetch dynamically imported module/],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    sentry
      ? {
          onUncaughtError: Sentry.reactErrorHandler(),
          onCaughtError: Sentry.reactErrorHandler(),
          onRecoverableError: Sentry.reactErrorHandler(),
        }
      : {},
  );
});
