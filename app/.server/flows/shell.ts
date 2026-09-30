import { isbot } from "isbot";
import { Effect, Option } from "effect";
import { AppConfig } from "../config";
import { CurrentRequest } from "../request";
import { DEFAULT_VARIANTS, Experiments, FLAGS, parseVariantOverride, type Variants } from "../services/Experiments";
import { Judge } from "../services/Judge";
import { Payments } from "../services/Payments";

/** Which one-tap wallet Stripe's checkout will offer this device, for the "Apple Pay or card" line. */
export type Wallet = "apple" | "google" | "card";

export const walletFor = (userAgent: string): Wallet => {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "apple";
  if (/Android/.test(userAgent)) return "google";
  const chromium = /Chrome\/|Chromium|CriOS|Edg\//.test(userAgent);
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !chromium && !/Firefox/.test(userAgent)) return "apple";
  return chromium ? "google" : "card";
};

export interface ShellData {
  readonly mode: { readonly payments: "autumn" | "fake"; readonly judge: "live" | "mock" };
  /** PostHog for the browser: the public project token, this visitor's id and their assigned test variants. */
  readonly analytics: { readonly token: string; readonly distinctId: string; readonly flags: Readonly<Record<string, string>> } | null;
  /** Sentry for the browser (its DSN is public), or null when it's off. */
  readonly sentry: { readonly dsn: string; readonly environment: string } | null;
  /** This visitor's variants of the live tests. */
  readonly experiments: Variants;
  readonly wallet: Wallet;
}

/** Root loader data: shared by every page (it runs once per full page load). */
export const loadShell = Effect.gen(function* () {
  const judge = yield* Judge;
  const payments = yield* Payments;
  const config = yield* AppConfig;
  const current = yield* CurrentRequest;
  const userAgent = current.request.headers.get("user-agent") ?? "";

  // Bots always get the defaults: no PostHog call, no exposure.
  let experiments = isbot(userAgent) ? DEFAULT_VARIANTS : yield* (yield* Experiments).variantsFor(current.visitorId);
  // Without PostHog (local development) a variant can be forced: ?variants=onboarding=guided,price=hidden
  const forced = current.url.searchParams.get("variants");
  if (Option.isNone(config.posthog) && forced) experiments = { ...experiments, ...parseVariantOverride(forced) };

  const flags: Record<string, string> = {
    ...(experiments.assigned.onboarding ? { [FLAGS.onboarding]: experiments.onboarding } : {}),
    ...(experiments.assigned.price ? { [FLAGS.price]: experiments.price } : {}),
  };
  return {
    mode: { payments: payments.kind, judge: judge.kind },
    analytics: Option.match(config.posthog, {
      onNone: () => null,
      onSome: ({ token }) => ({ token, distinctId: current.visitorId, flags }),
    }),
    sentry: Option.match(config.sentryBrowserDsn, {
      onNone: () => null,
      onSome: (dsn) => ({ dsn, environment: Option.isSome(config.publicUrl) ? "production" : "development" }),
    }),
    experiments,
    wallet: walletFor(userAgent),
  } satisfies ShellData;
});
