import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { JudgmentQueue } from "../services/JudgmentQueue";
import { Orders } from "../services/Orders";
import { CLAIM_STALE_MS, UNCLAIMED_STALE_MS } from "../services/Pipeline";

/** Unpaid orders older than this are no longer swept (checkout sessions expire after ~1h). */
const SWEEP_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Orders younger than this are checked every minute, older ones every 10 minutes. */
const FRESH_ORDER_MS = 15 * 60 * 1000;
/** An in-flight order untouched for this long is assumed lost and re-queued. */
const STALL_MS = CLAIM_STALE_MS;
/** Presence heartbeats older than this are pruned. */
const PRESENCE_TTL_MS = 60 * 60 * 1000;

/**
 * The cron trigger (every minute):
 * - confirms payments for buyers who paid and closed the tab,
 * - re-queues judgments that stalled (evicted worker, lost queue message…),
 * - prunes old presence heartbeats.
 * Every step is idempotent and failures in one don't stop the others.
 */
export const runMaintenance = Effect.gen(function* () {
  const orders = yield* Orders;
  const queue = yield* JudgmentQueue;
  const sql = yield* SqlClient.SqlClient;
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

  yield* sql`DELETE FROM presence WHERE last_seen_at < ${now - PRESENCE_TTL_MS}`.pipe(Effect.orDie);

  if (unpaid.length > 0 || stalled.length > 0) {
    yield* Effect.logInfo("Maintenance", { unpaidChecked: unpaid.length, stalledRequeued: stalled.length });
  }
}).pipe(Effect.withSpan("maintenance"));
