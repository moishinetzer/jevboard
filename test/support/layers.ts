import { Effect, Layer } from "effect";
import { AppConfig } from "~/.server/config";
import { CrawlError } from "~/.server/domain/errors";
import type { SiteSnapshot, Verdict } from "~/.server/domain/models";
import { Board } from "~/.server/services/Board";
import { Crawler } from "~/.server/services/Crawler";
import { Judge } from "~/.server/services/Judge";
import { Orders } from "~/.server/services/Orders";
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
  label: "test-label",
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
}

export const ScriptedJudge = (script: Script) =>
  Layer.succeed(
    Judge,
    Judge.of({
      kind: "mock",
      judge: (input) =>
        Effect.sync(() => {
          const score = script.scores[input.siteKey]?.shift() ?? 500;
          return {
            verdict: verdictFor(input.siteKey, score, script.overrides?.[input.siteKey]),
            model: "scripted",
            pagesFetchedByJev: [],
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

/** Fresh in-memory database + repositories + pipeline for one test. */
export const makeTestLayer = (script: Script, unreachable: ReadonlyArray<string> = []) => {
  const repos = Layer.mergeAll(Board.layer, Orders.layer).pipe(Layer.provideMerge(SqliteLocal()));
  return Pipeline.layer.pipe(
    Layer.provideMerge(repos),
    Layer.provide(Layer.mergeAll(ScriptedJudge(script), FakeCrawler(unreachable))),
    Layer.provideMerge(AppConfig.layerTest()),
  );
};
