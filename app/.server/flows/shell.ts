import { Effect, Option } from "effect";
import { AppConfig } from "../config";
import { CurrentRequest } from "../http";
import { Judge } from "../services/Judge";
import { Payments } from "../services/Payments";

export interface ShellData {
  readonly mode: { readonly payments: "autumn" | "fake"; readonly judge: "live" | "mock" };
  /** PostHog for the browser: the public project token and this visitor's id. */
  readonly analytics: { readonly token: string; readonly distinctId: string } | null;
}

/** Root loader data: shared by every page. */
export const loadShell = Effect.gen(function* () {
  const judge = yield* Judge;
  const payments = yield* Payments;
  const config = yield* AppConfig;
  const { visitorId } = yield* CurrentRequest;
  return {
    mode: { payments: payments.kind, judge: judge.kind },
    analytics: Option.match(config.posthog, {
      onNone: () => null,
      onSome: ({ token }) => ({ token, distinctId: visitorId }),
    }),
  } satisfies ShellData;
});
