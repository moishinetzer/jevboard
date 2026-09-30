import { useEffect } from "react";

/** What the browser needs to report to PostHog (from the root loader). */
export interface AnalyticsConfig {
  /** Public, write-only project token. */
  readonly token: string;
  /** The visitor's `jev_vid`, so browser and server events belong to one person. */
  readonly distinctId: string;
}

type PostHog = (typeof import("posthog-js"))["default"];

let loading: Promise<PostHog> | undefined;

/** The SDK, loaded after the page is interactive so it never delays first paint. */
const loadPostHog = (config: AnalyticsConfig): Promise<PostHog> => {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(config.token, {
      // Same-site proxy (workers/posthog-proxy.ts), so ad blockers leave it alone.
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "always",
      bootstrap: { distinctID: config.distinctId },
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_exceptions: true,
      // Session replay is switched on in the project settings; inputs stay masked.
      // Our own API calls carry the PostHog session id, which links server traces to the replay.
      tracing_headers: [window.location.hostname],
    });
    return posthog;
  });
  return loading;
};

/** Starts PostHog (pageviews, clicks, session replay, errors) once per page load. */
export function useAnalytics(config: AnalyticsConfig | null) {
  useEffect(() => {
    if (config) void loadPostHog(config);
  }, [config]);
}

/** Reports an error the app caught itself (error boundaries), when PostHog is running. */
export const reportError = (error: unknown) => {
  void loading?.then((posthog) => posthog.captureException(error));
};
