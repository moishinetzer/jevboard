import { Cause, Context, Effect, Layer, Random, Schedule, Semaphore } from "effect";
import type { CrawlError, JudgeError } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import { type DuelContender, TERMINAL_STATUSES, type Verdict } from "../domain/models";
import { Board, type DuelRecord, type PlacementResult } from "./Board";
import { Crawler } from "./Crawler";
import { Judge, type JudgeResult } from "./Judge";
import { Orders } from "./Orders";

/** Up to 2 retries with jittered exponential backoff for transient failures. */
const transientRetry = Schedule.max([Schedule.exponential("1 second").pipe(Schedule.jittered), Schedule.recurs(2)]);

const contenderFromVerdict = (siteKey: string, verdict: Verdict): DuelContender => ({
  siteKey,
  name: verdict.name,
  label: verdict.label,
  tldr: verdict.tldr,
  category: verdict.category,
  reasoning: verdict.reasoning,
  strengths: verdict.strengths,
  weaknesses: verdict.weaknesses,
});

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const crawlFailureMessage = (error: CrawlError): string => {
  switch (error.reason) {
    case "dns":
      return "Jev couldn't find that domain. Does it exist?";
    case "blocked":
      return "Jev isn't allowed to visit that address.";
    case "timeout":
      return "Your site took too long to answer. Jev got bored and left.";
    case "http":
      return `Your site answered with an error (${error.message}).`;
    case "not-html":
      return "That URL isn't a web page Jev can read.";
    case "too-large":
      return "Your homepage is too heavy for Jev to lift.";
    default:
      return `Jev couldn't reach your site (${error.message}).`;
  }
};

const judgeFailureMessage = (error: JudgeError): string =>
  error.reason === "refused"
    ? "Jev declined to judge this one."
    : "Jev's brain short-circuited while judging. Retry for free — you already paid.";

/**
 * Turns a paid order into a placed verdict:
 *
 *   crawl → judge → tiebreak duels (binary insertion) → atomic placement
 *
 * Every stage writes progress to the order row, which the judging page polls.
 * Placement runs under a global lock so concurrent judgments never interleave
 * inside the same tie group.
 */
export class Pipeline extends Context.Service<
  Pipeline,
  {
    readonly run: (orderId: OrderId) => Effect.Effect<void>;
  }
>()("jevboard/Pipeline") {
  static readonly layer = Layer.effect(
    Pipeline,
    Effect.gen(function* () {
      const orders = yield* Orders;
      const board = yield* Board;
      const crawler = yield* Crawler;
      const judge = yield* Judge;
      const placementLock = yield* Semaphore.make(1);

      /**
       * Binary insertion into the group of entries sharing the exact same score.
       * Each probe is a head-to-head duel judged by Jev; ⌈log2(n+1)⌉ duels place
       * the entry among n rivals.
       */
      const tiebreak = Effect.fn("Pipeline.tiebreak")(function* (
        orderId: OrderId,
        siteKey: string,
        verdict: Verdict,
      ) {
        const group = yield* board.tiedGroup(verdict.score, siteKey);
        if (group.length === 0) return { tieOrder: [null], duels: [] as Array<DuelRecord> };

        const challenger = contenderFromVerdict(siteKey, verdict);
        const expected = Math.ceil(Math.log2(group.length + 1));
        const duels: Array<DuelRecord> = [];
        let lo = 0;
        let hi = group.length;

        yield* orders.setStage(
          orderId,
          "tiebreaking",
          `${verdict.score} = ${verdict.score}. Jev doesn't do draws. ${group.length} rival${group.length === 1 ? "" : "s"} share this score — entering the Duel Pit…`,
        );

        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const opponent = group[mid]!;
          yield* orders.setDetail(
            orderId,
            `⚔️ Duel ${duels.length + 1} of ~${expected}: ${siteKey} vs ${opponent.siteKey} (both ${verdict.score})`,
          );
          // Shuffle sides so position bias can't favour either party.
          const challengerIsA = yield* Random.nextBoolean;
          const outcome = yield* judge
            .duel({
              score: verdict.score,
              a: challengerIsA ? challenger : opponent.contender,
              b: challengerIsA ? opponent.contender : challenger,
            })
            .pipe(
              Effect.retry({ schedule: transientRetry, while: (error: JudgeError) => error.retryable }),
              Effect.catch((error) =>
                Effect.logWarning("Duel failed, seniority wins", error).pipe(
                  Effect.as({
                    winner: challengerIsA ? ("B" as const) : ("A" as const),
                    reason: "Jev's gavel jammed mid-duel, so seniority wins this one.",
                  }),
                ),
              ),
            );
          const challengerWon = (outcome.winner === "A") === challengerIsA;
          duels.push({
            opponentId: opponent.id,
            opponentSiteKey: opponent.siteKey,
            challengerWon,
            reason: outcome.reason,
          });
          if (challengerWon) hi = mid;
          else lo = mid + 1;
        }

        const tieOrder = [...group.slice(0, lo).map((entry) => entry.id), null, ...group.slice(lo).map((entry) => entry.id)];
        return { tieOrder, duels };
      });

      const place = Effect.fn("Pipeline.place")(function* (
        orderId: OrderId,
        order: { readonly siteKey: string; readonly url: string },
        result: JudgeResult,
        snapshot: Parameters<typeof board.commitPlacement>[0]["snapshot"],
      ) {
        const { verdict } = result;
        const flagged = verdict.contentFlag !== "none";
        const { tieOrder, duels } = flagged ? { tieOrder: [], duels: [] } : yield* tiebreak(orderId, order.siteKey, verdict);
        const pagesCrawled = [...new Set([...snapshot.pages.map((page) => page.url), ...result.pagesFetchedByJev])];
        return yield* board.commitPlacement({
          orderId,
          siteKey: order.siteKey,
          url: order.url,
          host: hostOf(order.url),
          verdict,
          snapshot,
          model: result.model,
          pagesCrawled,
          tieOrder,
          duels,
        });
      });

      const process = Effect.fn("Pipeline.process")(function* (orderId: OrderId) {
        const order = yield* orders.get(orderId);
        if (order.status === "pending_payment" || TERMINAL_STATUSES.includes(order.status)) return;
        const host = hostOf(order.url);

        yield* orders.setStage(orderId, "crawling", `Jev is knocking on ${host}…`);
        const snapshot = yield* crawler.crawl(order.url).pipe(
          Effect.retry({
            schedule: transientRetry,
            while: (error: CrawlError) => error.reason === "timeout" || error.reason === "unreachable",
          }),
        );
        const pageList = snapshot.pages.map((page) => new URL(page.url).pathname).join(", ");

        const existing = yield* board.findBySiteKey(order.siteKey);
        const roll = (existing._tag === "Some" ? existing.value.rolls : 0) + 1;
        yield* orders.setStage(
          orderId,
          "judging",
          `Jev read ${snapshot.pages.length} page${snapshot.pages.length === 1 ? "" : "s"} (${pageList}). Deliberating…`,
        );
        const result = yield* judge
          .judge({ siteKey: order.siteKey, url: order.url, snapshot, roll, fresh: order.kind === "reroll" })
          .pipe(Effect.retry({ schedule: transientRetry, while: (error: JudgeError) => error.retryable }));

        yield* orders.setStage(orderId, "tiebreaking", `Jev scored it ${result.verdict.score}/1000. Finding its place on the board…`);
        const placement: PlacementResult = yield* Semaphore.withPermit(placementLock)(
          place(orderId, order, result, snapshot),
        );
        yield* orders.complete(orderId, { entryId: placement.entryId, judgmentId: placement.judgmentId });
        yield* Effect.logInfo("Judgment placed", {
          siteKey: placement.siteKey,
          score: placement.score,
          rank: placement.rank,
          roll: placement.roll,
        });
      });

      const run = (orderId: OrderId) =>
        process(orderId).pipe(
          Effect.catchTags({
            NotFound: () => Effect.logWarning("Order vanished", { orderId }),
            CrawlError: (error) =>
              Effect.logWarning("Crawl failed", error).pipe(Effect.andThen(orders.fail(orderId, crawlFailureMessage(error)))),
            JudgeError: (error) =>
              Effect.logError("Judge failed", error).pipe(Effect.andThen(orders.fail(orderId, judgeFailureMessage(error)))),
          }),
          Effect.catchCause((cause) =>
            // On shutdown the order stays in flight and is picked up again on boot.
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logError("Pipeline defect", cause).pipe(
                  Effect.andThen(orders.fail(orderId, "Something broke inside Jev. Retry for free — you already paid.")),
                ),
          ),
          Effect.annotateLogs({ orderId }),
          Effect.withSpan("Pipeline.run", { attributes: { orderId } }),
        );

      return Pipeline.of({ run });
    }),
  );
}
