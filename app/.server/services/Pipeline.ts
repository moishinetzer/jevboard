import { Cause, Context, Effect, Layer, Option, Random, Semaphore } from "effect";
import { type CrawlError, isTransientCrawlError, type JudgeError, type NotFound } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import { type DuelContender, siteProfileOf, TERMINAL_STATUSES, type Verdict } from "../domain/models";
import { Board, type DuelRecord, type PlacementResult } from "./Board";
import { Crawler } from "./Crawler";
import { Judge } from "./Judge";
import { AnalyticsActor, track } from "./Analytics";
import { Orders } from "./Orders";
import { Payments } from "./Payments";
import { makeRefunder } from "./refunds";

/**
 * An in-flight judgment untouched for this long is considered abandoned and
 * may be re-claimed (a single judging job is bounded well below this).
 */
export const CLAIM_STALE_MS = 20 * 60 * 1000;

/**
 * A paid order nobody has claimed for this long lost its queue message; re-queue it.
 * Longer than the longest queue retry delay, so a job waiting out its backoff isn't doubled.
 */
export const UNCLAIMED_STALE_MS = 5 * 60 * 1000;

/**
 * Wall-clock budget for all duels of one placement. The placement queue runs
 * one job at a time inside a 15-minute consumer limit, so a slow Jev must not
 * stall it: once the budget is spent, remaining duels go to seniority.
 */
const TIEBREAK_BUDGET_MS = 8 * 60 * 1000;


const contenderFromVerdict = (siteKey: string, verdict: Verdict): DuelContender => ({
  siteKey,
  name: verdict.name,
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
      return "Jev couldn't find that domain, even after several tries.";
    case "blocked":
      return "Jev isn't allowed to visit that address.";
    case "timeout":
      return "Your site kept timing out, even after several tries.";
    case "http":
      return error.status === 401 || error.status === 403
        ? `Your site turned Jev's crawler away (HTTP ${error.status}).`
        : `Your site answered with an error (${error.message}).`;
    case "not-html":
      return "That URL isn't a web page Jev can read.";
    case "too-large":
      return "Your homepage is too heavy for Jev to lift.";
    case "offsite":
      return `Your site ${error.message} now, so Jev can't judge it as itself. Submit the site it lands on.`;
    default:
      return `Jev couldn't connect to your site (${error.message}).`;
  }
};

const judgeFailureMessage = (error: JudgeError): string =>
  error.reason === "refused" ? "Jev declined to judge this one." : "Jev's brain short-circuited while judging.";

/** Shown on the judging page while a job waits for its queue retry. */
const WAITING_ON_SITE = "Your site isn't answering yet. Jev will try again in a minute…";
const WAITING_ON_JEV = "Jev needs a moment. Trying again shortly…";

/** When every retry is spent and nothing more specific was recorded. */
const GAVE_UP = "Jev tried several times and couldn't finish.";

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
    /**
     * Stage 1. Fails only with problems worth another try later (a site that
     * isn't answering, a busy Jev); retry the job. Defects also escape.
     */
    readonly judge: (orderId: OrderId) => Effect.Effect<JudgeStageResult, JudgeError | CrawlError>;
    /** Stage 2. Idempotent; defects escape so the job is retried. */
    readonly place: (orderId: OrderId) => Effect.Effect<void>;
    /** Marks the order failed (and refunds it) once its job ran out of retries. */
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
      const refund = makeRefunder(orders, yield* Payments);
      // Serializes placements for the in-process runner; on Cloudflare the placement queue does.
      const placementLock = yield* Semaphore.make(1);

      /**
       * Ends a judgment without a verdict. A paid order is refunded right away;
       * if the refund call fails, the order stays due and the cron retries it.
       */
      const failAndRefund = (orderId: OrderId, message: string, token?: string) =>
        orders.fail(orderId, message, token).pipe(
          Effect.flatMap((failed) =>
            failed
              ? Effect.gen(function* () {
                  const order = yield* orders.find(orderId);
                  yield* track(
                    "judgment_failed",
                    { order_id: orderId, reason: message, ...(Option.isSome(order) ? { site: order.value.siteKey } : {}) },
                    Option.isSome(order) ? { distinctId: order.value.customerId } : undefined,
                  );
                  yield* refund(orderId).pipe(
                    Effect.catchTag("PaymentError", () => Effect.void),
                    Effect.catchTag("NotFound", () => Effect.void),
                  );
                })
              : Effect.void,
          ),
          Effect.as("failed" as const),
        );

      /** Links a job's spans and LLM generations to the buyer (their visitor id) and the order. */
      const actorFor = (order: { readonly id: OrderId; readonly customerId: string; readonly siteKey: string }) =>
        Effect.annotateCurrentSpan({ posthogDistinctId: order.customerId, "order.id": order.id, "order.site": order.siteKey }).pipe(
          Effect.as({ distinctId: order.customerId, sessionId: null, traceId: order.id }),
        );

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
          "Finding its exact spot on the board…",
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
            `Comparing it with the neighbours (${duels.length + 1} of ~${expected})…`,
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
       * Fails (and refunds) the order for definitive problems: a site that
       * says no (403, 404, not a web page), a refusal. Problems that may pass
       * (a site timing out after the crawler's own retries, a busy Jev) and
       * infrastructure defects release the claim and escape, so the queue
       * retries the job with a growing delay; `giveUp` refunds when it's out
       * of retries.
       */
      const judgeStage = Effect.fn("Pipeline.judge")(function* (orderId: OrderId) {
        const order = yield* orders.get(orderId);
        const actor = yield* actorFor(order);
        if (order.status === "pending_payment" || TERMINAL_STATUSES.includes(order.status)) return "skipped" as const;
        if (Option.isSome(yield* orders.stagedVerdict(orderId))) return "judged" as const;
        const claimed = yield* orders.claim(orderId, Date.now() - CLAIM_STALE_MS);
        if (Option.isNone(claimed)) return "skipped" as const; // another job owns it
        const token = claimed.value;

        const work = Effect.gen(function* () {
          const host = hostOf(order.url);
          yield* orders.setStage(orderId, "crawling", `Jev is knocking on ${host}…`, token);
          // The crawler retries each page itself; a crawl that still fails and may
          // pass later goes back to the queue (see the catch below).
          const snapshot = yield* crawler.crawl(order.url);
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
            intake: order.intake,
          });
          const staged = yield* orders.stageVerdict(
            orderId,
            {
              verdict: result.verdict,
              model: result.model,
              pagesCrawled: snapshot.pages.map((page) => page.url),
              ogImage: snapshot.ogImage,
              site: siteProfileOf(snapshot),
            },
            token,
          );
          if (!staged) return "skipped" as const; // lost the claim while working
          yield* orders.setStage(
            orderId,
            "tiebreaking",
            "Jev has a verdict. Finding its place on the board…",
            token,
          );
          return "judged" as const;
        });

        return yield* work.pipe(
          Effect.catchTags({
            CrawlError: (error) =>
              isTransientCrawlError(error)
                ? Effect.logWarning("Crawl failed; the queue will retry", error).pipe(
                    Effect.andThen(
                      orders.release(orderId, token, { detail: WAITING_ON_SITE, error: crawlFailureMessage(error) }),
                    ),
                    Effect.andThen(Effect.fail(error)),
                  )
                : Effect.logWarning("Crawl failed", error).pipe(
                    Effect.andThen(failAndRefund(orderId, crawlFailureMessage(error), token)),
                  ),
            JudgeError: (error) =>
              error.retryable
                ? orders
                    .release(orderId, token, { detail: WAITING_ON_JEV, error: judgeFailureMessage(error) })
                    .pipe(Effect.andThen(Effect.fail(error)))
                : Effect.logError("Judge failed", error).pipe(
                    Effect.andThen(failAndRefund(orderId, judgeFailureMessage(error), token)),
                  ),
          }),
          Effect.tapCause((cause) =>
            Cause.hasDies(cause) ? orders.release(orderId, token) : Effect.void,
          ),
          Effect.provideService(AnalyticsActor, actor),
        );
      });

      /**
       * Stage 2: tiebreak duels + placement. Runs one at a time (placement
       * queue) and is idempotent: a judgment already written for this order
       * just completes it.
       */
      const placeStage = Effect.fn("Pipeline.place")(function* (orderId: OrderId) {
        const order = yield* orders.get(orderId);
        const actor = yield* actorFor(order);
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
        const { verdict, model, pagesCrawled, ogImage, site } = staged.value;
        const flagged = verdict.contentFlag !== "none";
        const { tieOrder, duels } = flagged
          ? { tieOrder: [], duels: [] }
          : yield* tiebreak(orderId, order.siteKey, verdict).pipe(Effect.provideService(AnalyticsActor, actor));
        const placement: PlacementResult = yield* board.commitPlacement({
          orderId,
          siteKey: order.siteKey,
          // The board links to the page the buyer picked in the guided onboarding, else the address they gave.
          url: order.intake?.landingUrl ?? order.url,
          host: hostOf(order.url),
          verdict,
          ogImage,
          site,
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
        yield* track(
          "judgment_completed",
          {
            order_id: orderId,
            site: placement.siteKey,
            kind: order.kind,
            score: placement.score,
            rank: placement.rank,
            roll: placement.roll,
            model,
            listed: !flagged,
            content_flag: verdict.contentFlag,
            duels: duels.length,
            manipulation_attempt: verdict.manipulationAttempt,
          },
          { distinctId: order.customerId },
        );
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

      /** Fails and refunds a paid order after its job exhausted every retry, keeping the last problem as the reason. */
      const giveUp = (orderId: OrderId) =>
        orders.get(orderId).pipe(
          Effect.flatMap((order) => failAndRefund(orderId, order.error ?? GAVE_UP)),
          Effect.catchTag("NotFound", (_: NotFound) => Effect.logWarning("Order vanished", { orderId })),
          Effect.asVoid,
        );

      return Pipeline.of({
        judge: judgeJob,
        place: placeJob,
        giveUp,
        run: (orderId) =>
          judgeJob(orderId).pipe(
            // In-process there is no queue to retry with: a retryable failure ends (and refunds) the order.
            Effect.catchTags({
              JudgeError: (error) => failAndRefund(orderId, judgeFailureMessage(error)),
              CrawlError: (error) => failAndRefund(orderId, crawlFailureMessage(error)),
            }),
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
