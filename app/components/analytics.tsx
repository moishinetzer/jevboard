import * as Sentry from "@sentry/react";
import { useEffect } from "react";

/** What the browser needs to report to PostHog (from the root loader). */
export interface AnalyticsConfig {
  /** Public, write-only project token. */
  readonly token: string;
  /** The visitor's `jev_vid`, so browser and server events belong to one person. */
  readonly distinctId: string;
  /** Test variants the server assigned (PostHog feature flags), so the SDK agrees with the page. */
  readonly flags: Readonly<Record<string, string>>;
}

type PostHog = (typeof import("posthog-js"))["default"];

let loading: Promise<PostHog> | undefined;
/** Calls made before the SDK started (child effects run before the root's), replayed once it has. */
const pending: Array<(posthog: PostHog) => void> = [];

const withPostHog = (use: (posthog: PostHog) => void) => {
  if (loading) void loading.then(use);
  else if (typeof window !== "undefined" && pending.length < 50) pending.push(use);
};

/** The SDK, loaded after the page is interactive so it never delays first paint. */
const loadPostHog = (config: AnalyticsConfig): Promise<PostHog> => {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(config.token, {
      // Same-site proxy (workers/posthog-proxy.ts), so ad blockers leave it alone.
      api_host: "/rbj",
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      person_profiles: "always",
      bootstrap: { distinctID: config.distinctId, featureFlags: { ...config.flags } },
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_exceptions: true,
      // Session replay is switched on in the project settings; inputs stay masked.
      // Our own API calls carry the PostHog session id, which links server traces to the replay.
      tracing_headers: [window.location.hostname],
    });
    for (const use of pending.splice(0)) use(posthog);
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

/** Reports an error the app caught itself (error boundaries) to Sentry and, when it's running, PostHog. */
export const reportError = (error: unknown) => {
  Sentry.captureException(error);
  withPostHog((posthog) => posthog.captureException(error));
};

/**
 * Records that this visitor saw their variant of a test (PostHog's
 * `$feature_flag_called`, which experiments count as exposure). Only for flags
 * the server actually assigned: defaults shown after a PostHog timeout aren't
 * part of the test.
 */
export const reportExposure = (flag: string, assigned: boolean) => {
  if (!assigned) return;
  withPostHog((posthog) => posthog.getFeatureFlag(flag));
};

/** A product event from the browser, when PostHog is running. */
export const capture = (event: string, properties?: Record<string, unknown>) => {
  withPostHog((posthog) => posthog.capture(event, properties));
};
