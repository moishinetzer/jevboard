import { Effect } from "effect";
import { JudgmentQueue } from "../services/JudgmentQueue";
import { Orders } from "../services/Orders";
import { Payments } from "../services/Payments";
import { CLAIM_STALE_MS, UNCLAIMED_STALE_MS } from "../services/Pipeline";
import { makeRefunder } from "../services/refunds";

/** Unpaid orders older than this are no longer swept (checkout sessions expire after ~1h). */
const SWEEP_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Orders younger than this are checked every minute, older ones every 10 minutes. */
const FRESH_ORDER_MS = 15 * 60 * 1000;
/** Refunds retried per run. */
const REFUND_BATCH = 20;
/** An in-flight order untouched for this long is assumed lost and re-queued. */
const STALL_MS = CLAIM_STALE_MS;

/**
 * The cron trigger (every minute):
 * - confirms payments for buyers who paid and closed the tab,
 * - re-queues judgments that stalled (evicted worker, lost queue message…),
 * - retries refunds that didn't go through when the judgment failed.
 * Every step is idempotent and failures in one don't stop the others.
 */
export const runMaintenance = Effect.gen(function* () {
  const orders = yield* Orders;
  const queue = yield* JudgmentQueue;
  const now = Date.now();

  const everyTenMinutes = new Date(now).getUTCMinutes() % 10 === 0;
  const unpaid = (yield* orders.awaitingPayment(now - SWEEP_WINDOW_MS)).filter(
    (order) => everyTenMinutes || now - order.createdAt < FRESH_ORDER_MS,
  );
  let settled = 0;
  for (const order of unpaid) {
    yield* queue.settle(order.id, order.customerId).pipe(
      Effect.tap(() => Effect.sync(() => settled++)),
      Effect.catchTag("PaymentError", (error) => Effect.logDebug("Sweeper: payment check failed", error)),
    );
  }

  const stalled = yield* orders.stalled(now - STALL_MS, now - UNCLAIMED_STALE_MS);
  // Re-queued as-is: the stale `updated_at` is what lets the judging stage re-claim them.
  for (const order of stalled) yield* queue.enqueue(order.id);

  // Refunds that failed when the order did: fresh ones every minute, then every ten.
  const refund = makeRefunder(orders, yield* Payments);
  const refundsDue = (yield* orders.refundsDue(REFUND_BATCH)).filter(
    (order) => everyTenMinutes || now - order.updatedAt < FRESH_ORDER_MS,
  );
  let refunded = 0;
  for (const order of refundsDue) {
    const state = yield* refund(order.id).pipe(
      Effect.catchTags({ PaymentError: () => Effect.succeed("due" as const), NotFound: () => Effect.succeed(null) }),
    );
    if (state === "done") refunded++;
  }

  if (unpaid.length > 0 || stalled.length > 0 || refundsDue.length > 0) {
    yield* Effect.logInfo("Maintenance", {
      unpaidChecked: unpaid.length,
      stalledRequeued: stalled.length,
      refundsTried: refundsDue.length,
      refunded,
    });
  }
}).pipe(Effect.withSpan("maintenance"));
