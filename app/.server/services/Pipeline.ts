import { Cause, Context, Effect, Layer, Option, Random, Schedule, Semaphore } from "effect";
import type { CrawlError, JudgeError } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import { type DuelContender, TERMINAL_STATUSES, type Verdict } from "../domain/models";
import { Board, type DuelRecord, type PlacementResult } from "./Board";
import { Crawler } from "./Crawler";
import { Judge } from "./Judge";
import { Orders } from "./Orders";

/**
 * An in-flight judgment untouched for this long is considered abandoned and
 * may be re-claimed (a single judging job is bounded well below this).
 */
export const CLAIM_STALE_MS = 20 * 60 * 1000;

/** A paid order nobody has claimed for this long lost its queue message; re-queue it. */
export const UNCLAIMED_STALE_MS = 2 * 60 * 1000;

/**
 * Wall-clock budget for all duels of one placement. The placement queue runs
 * one job at a time inside a 15-minute consumer limit, so a slow Jev must not
 * stall it: once the budget is spent, remaining duels go to seniority.
 */
const TIEBREAK_BUDGET_MS = 8 * 60 * 1000;

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
    case "offsite":
      return `Your site ${error.message} now, so Jev can't judge it as itself. Submit the site it lands on.`;
    default:
      return `Jev couldn't reach your site (${error.message}).`;
  }
};

const judgeFailureMessage = (error: JudgeError): string =>
  error.reason === "refused"
    ? "Jev declined to judge this one."
    : "Jev's brain short-circuited while judging. Retry for free — you already paid.";

/** Outcome of the judging stage. */
export type JudgeStageResult = "judged" | "skipped" | "failed";

/**
 * Turns a paid order into a placed verdict, in two stages:
 *
 *   1. judge:  crawl → Jev's verdict (parked on the order row)
 *   2. place:  tiebreak duels (binary insertion) → atomic placement
 *
 * On Cloudflare the stages run as jobs on two queues; the placement queue
 * processes one job at a time so concurrent verdicts never interleave inside
 * a tie group. Both stages are idempotent (queues deliver at least once).
 * Every step writes progress to the order row, which the judging page polls.
 */
export class Pipeline extends Context.Service<
  Pipeline,
  {
    /** Stage 1. Fails only with retryable Jev errors (defects also escape) — retry the job. */
    readonly judge: (orderId: OrderId) => Effect.Effect<JudgeStageResult, JudgeError>;
    /** Stage 2. Idempotent; defects escape so the job is retried. */
    readonly place: (orderId: OrderId) => Effect.Effect<void>;
    /** Marks the order failed once its job ran out of retries. */
    readonly giveUp: (orderId: OrderId) => Effect.Effect<void>;
    /** Both stages back to back, failures handled (in-process queue, tests). */
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
      // Serializes placements for the in-process runner; on Cloudflare the placement queue does.
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

        const deadline = Date.now() + TIEBREAK_BUDGET_MS;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const opponent = group[mid]!;
          if (Date.now() > deadline) {
            // Out of time: the rest of the group keeps its seniority.
            duels.push({
              opponentId: opponent.id,
              opponentSiteKey: opponent.siteKey,
              challengerWon: false,
              reason: "Jev ran out of court time, so seniority wins this one.",
            });
            lo = mid + 1;
            continue;
          }
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
              Effect.retry({ times: 1, while: (error: JudgeError) => error.retryable }),
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

      /**
       * Stage 1: crawl + verdict, parked on the order. Only the job holding the
       * claim may write, so a duplicate or stale job can't clobber progress.
       *
       * Fails the order for definitive problems (unreachable site, refusal).
       * Retryable Jev errors and infrastructure defects release the claim and
       * escape, so the queue retries the job with backoff.
       */
      const judgeStage = Effect.fn("Pipeline.judge")(function* (orderId: OrderId) {
        const order = yield* orders.get(orderId);
        if (order.status === "pending_payment" || TERMINAL_STATUSES.includes(order.status)) return "skipped" as const;
        if (Option.isSome(yield* orders.stagedVerdict(orderId))) return "judged" as const;
        const claimed = yield* orders.claim(orderId, Date.now() - CLAIM_STALE_MS);
        if (Option.isNone(claimed)) return "skipped" as const; // another job owns it
        const token = claimed.value;

        const work = Effect.gen(function* () {
          const host = hostOf(order.url);
          yield* orders.setStage(orderId, "crawling", `Jev is knocking on ${host}…`, token);
          const snapshot = yield* crawler.crawl(order.url).pipe(
            Effect.retry({
              schedule: transientRetry,
              while: (error: CrawlError) => error.reason === "timeout" || error.reason === "unreachable",
            }),
          );
          const pageList = snapshot.pages.map((page) => new URL(page.url).pathname).join(", ");
          const roll = (yield* board.rollsFor(order.siteKey)) + 1;
          yield* orders.setStage(
            orderId,
            "judging",
            `Jev read ${snapshot.pages.length} page${snapshot.pages.length === 1 ? "" : "s"} (${pageList}). Deliberating…`,
            token,
          );
          // One attempt per job: a retryable failure goes back to the queue,
          // which keeps each job inside the consumer's wall-clock limit.
          const result = yield* judge.judge({
            siteKey: order.siteKey,
            url: order.url,
            snapshot,
            roll,
            fresh: roll > 1,
          });
          const staged = yield* orders.stageVerdict(
            orderId,
            {
              verdict: result.verdict,
              model: result.model,
              pagesCrawled: [...new Set([...snapshot.pages.map((page) => page.url), ...result.pagesFetchedByJev])],
              ogImage: snapshot.ogImage,
            },
            token,
          );
          if (!staged) return "skipped" as const; // lost the claim while working
          yield* orders.setStage(
            orderId,
            "tiebreaking",
            `Jev scored it ${result.verdict.score}/1000. Finding its place on the board…`,
            token,
          );
          return "judged" as const;
        });

        return yield* work.pipe(
          Effect.catchTags({
            CrawlError: (error) =>
              Effect.logWarning("Crawl failed", error).pipe(
                Effect.andThen(orders.fail(orderId, crawlFailureMessage(error), token)),
                Effect.as("failed" as const),
              ),
            JudgeError: (error) =>
              error.retryable
                ? orders.release(orderId, token).pipe(Effect.andThen(Effect.fail(error)))
                : Effect.logError("Judge failed", error).pipe(
                    Effect.andThen(orders.fail(orderId, judgeFailureMessage(error), token)),
                    Effect.as("failed" as const),
                  ),
          }),
          Effect.tapCause((cause) =>
            Cause.hasDies(cause) ? orders.release(orderId, token) : Effect.void,
          ),
        );
      });

      /**
       * Stage 2: tiebreak duels + placement. Runs one at a time (placement
       * queue) and is idempotent: a judgment already written for this order
       * just completes it.
       */
      const placeStage = Effect.fn("Pipeline.place")(function* (orderId: OrderId) {
        const order = yield* orders.get(orderId);
        if (order.status === "pending_payment" || TERMINAL_STATUSES.includes(order.status)) return;
        const existing = yield* board.judgmentForOrder(orderId);
        if (Option.isSome(existing)) {
          yield* orders.complete(orderId, { entryId: existing.value.entryId, judgmentId: existing.value.id });
          return;
        }
        const staged = yield* orders.stagedVerdict(orderId);
        if (Option.isNone(staged)) {
          return yield* Effect.logWarning("Placement requested before a verdict was staged", { orderId });
        }
        const { verdict, model, pagesCrawled, ogImage } = staged.value;
        const flagged = verdict.contentFlag !== "none";
        const { tieOrder, duels } = flagged ? { tieOrder: [], duels: [] } : yield* tiebreak(orderId, order.siteKey, verdict);
        const placement: PlacementResult = yield* board.commitPlacement({
          orderId,
          siteKey: order.siteKey,
          url: order.url,
          host: hostOf(order.url),
          verdict,
          ogImage,
          model,
          pagesCrawled,
          tieOrder,
          duels,
        });
        yield* Effect.logInfo("Judgment placed", {
          siteKey: placement.siteKey,
          score: placement.score,
          rank: placement.rank,
          roll: placement.roll,
        });
      });

      const judgeJob = (orderId: OrderId) =>
        judgeStage(orderId).pipe(
          Effect.catchTag("NotFound", () => Effect.logWarning("Order vanished", { orderId }).pipe(Effect.as("skipped" as const))),
          Effect.annotateLogs({ orderId }),
          Effect.withSpan("Pipeline.judgeJob"),
        );

      // The placement queue (max_concurrency 1) serializes jobs on Cloudflare.
      const placeJob = (orderId: OrderId) =>
        placeStage(orderId).pipe(
          Effect.catchTag("NotFound", () => Effect.logWarning("Order vanished", { orderId })),
          Effect.annotateLogs({ orderId }),
          Effect.withSpan("Pipeline.placeJob"),
        );

      /** Marks a paid order failed after its job exhausted every retry. */
      const giveUp = (orderId: OrderId) =>
        orders.fail(orderId, "Something broke inside Jev. Retry for free — you already paid.");

      return Pipeline.of({
        judge: judgeJob,
        place: placeJob,
        giveUp,
        run: (orderId) =>
          judgeJob(orderId).pipe(
            // In-process there is no queue to retry with: a retryable failure ends the order.
            Effect.catchTag("JudgeError", (error) =>
              orders.fail(orderId, judgeFailureMessage(error)).pipe(Effect.as("failed" as const)),
            ),
            // In-process there's no queue: the lock plays its part.
            Effect.flatMap((result) =>
              result === "judged" ? Semaphore.withPermit(placementLock)(placeJob(orderId)) : Effect.void,
            ),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : Effect.logError("Judgment failed", cause).pipe(Effect.andThen(giveUp(orderId))),
            ),
          ),
      });
    }),
  );
}
