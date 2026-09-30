import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/sql";
import { AppConfig } from "~/.server/config";
import { CrawlError, PaymentError } from "~/.server/domain/errors";
import type { SiteSnapshot, Verdict } from "~/.server/domain/models";
import { Board } from "~/.server/services/Board";
import { Crawler } from "~/.server/services/Crawler";
import { Judge } from "~/.server/services/Judge";
import { Orders } from "~/.server/services/Orders";
import { Payments } from "~/.server/services/Payments";
import { Pipeline } from "~/.server/services/Pipeline";
import { SqliteLocal } from "./sqlite";

export const snapshotFor = (siteKey: string): SiteSnapshot => ({
  requestedUrl: `https://${siteKey}/`,
  finalUrl: `https://${siteKey}/`,
  host: siteKey,
  title: siteKey,
  description: `${siteKey} does things.`,
  ogImage: null,
  favicon: null,
  pages: [{ url: `https://${siteKey}/`, title: siteKey, description: "", headings: [], text: `${siteKey} does things.` }],
  fetchedAt: 0,
});

export const verdictFor = (siteKey: string, score: number, overrides: Partial<Verdict> = {}): Verdict => ({
  name: siteKey,
  tldr: `${siteKey} does things.`,
  category: "SaaS",
  score,
  verdict: "Fine.",
  reasoning: "Because.",
  subscores: { clarity: 50, demand: 50, originality: 50, trust: 50, wouldJevPay: 50 },
  strengths: [],
  weaknesses: [],
  receipts: [],
  manipulationAttempt: false,
  contentFlag: "none",
  ...overrides,
});

/**
 * A scripted Jev: `scores[siteKey]` is the next verdict score (shift()ed per
 * roll), and duels are won by whoever has the higher `strength`.
 */
export interface Script {
  readonly scores: Record<string, Array<number>>;
  readonly strength: Record<string, number>;
  readonly overrides?: Record<string, Partial<Verdict>>;
  duels: number;
  /** Counts judge calls when present. */
  judged?: number;
  /** Makes each judge call take this long (use with it.live). */
  readonly judgeDelayMs?: number;
  /** Order ids refunded, in order, when present. */
  refunds?: Array<string>;
  /** The next this-many refund calls fail with a PaymentError. */
  refundFailures?: number;
}

/** Payments that record refunds (checkout and confirmation aren't exercised by the pipeline). */
export const RecordingPayments = (script: Script) =>
  Layer.succeed(
    Payments,
    Payments.of({
      kind: "fake",
      createCheckout: () => Effect.die("checkout is not part of the pipeline"),
      confirm: () => Effect.succeed("paid" as const),
      refund: ({ orderId }) =>
        Effect.suspend(() => {
          if ((script.refundFailures ?? 0) > 0) {
            script.refundFailures = (script.refundFailures ?? 0) - 1;
            return Effect.fail(new PaymentError({ message: "Payment provider error (HTTP 503)", status: 503 }));
          }
          script.refunds?.push(orderId);
          return Effect.succeed("refunded" as const);
        }),
    }),
  );

export const ScriptedJudge = (script: Script) =>
  Layer.succeed(
    Judge,
    Judge.of({
      kind: "mock",
      judge: (input) =>
        Effect.gen(function* () {
          if (script.judgeDelayMs) yield* Effect.sleep(`${script.judgeDelayMs} millis`);
          if (script.judged !== undefined) script.judged++;
          const score = script.scores[input.siteKey]?.shift() ?? 500;
          return {
            verdict: verdictFor(input.siteKey, score, script.overrides?.[input.siteKey]),
            model: "scripted",
          };
        }),
      duel: (input) =>
        Effect.sync(() => {
          script.duels++;
          const a = script.strength[input.a.siteKey] ?? 0;
          const b = script.strength[input.b.siteKey] ?? 0;
          return { winner: a >= b ? ("A" as const) : ("B" as const), reason: "stronger" };
        }),
    }),
  );

export const FakeCrawler = (unreachable: ReadonlyArray<string> = []) =>
  Layer.succeed(
    Crawler,
    Crawler.of({
      preflight: (url) => Effect.succeed({ finalUrl: url }),
      crawl: (url) => {
        const host = new URL(url).hostname;
        return unreachable.includes(host)
          ? Effect.fail(new CrawlError({ url, reason: "dns", message: "ENOTFOUND" }))
          : Effect.succeed(snapshotFor(host));
      },
    }),
  );

/**
 * Fresh in-memory database + repositories + pipeline for one test. Payments
 * default to `RecordingPayments(script)`; pass a layer (it may use the
 * database) to swap them.
 */
export const makeTestLayer = (
  script: Script,
  unreachable: ReadonlyArray<string> = [],
  payments: Layer.Layer<Payments, never, SqlClient.SqlClient> = RecordingPayments(script),
) => {
  const repos = Layer.mergeAll(Board.layer, Orders.layer).pipe(Layer.provideMerge(SqliteLocal()));
  return Pipeline.layer.pipe(
    Layer.provideMerge(payments),
    Layer.provideMerge(repos),
    Layer.provide(Layer.mergeAll(ScriptedJudge(script), FakeCrawler(unreachable))),
    Layer.provideMerge(AppConfig.layerTest()),
  );
};
