import { Effect } from "effect";
import type { PaymentError } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import type { RefundState } from "../domain/models";
import { track } from "./Analytics";
import type { Orders } from "./Orders";
import type { Payments } from "./Payments";

/**
 * A paid order whose payment the provider can't find is retried this many
 * times (invoices can lag the payment) before it's closed as nothing to refund.
 */
const MISSING_PAYMENT_ATTEMPTS = 5;

/** Refunds that keep failing past this many attempts are logged as errors on every try. */
export const STUCK_REFUND_ATTEMPTS = 10;

/**
 * Builds `refund(orderId)`: gives the buyer their $5 back for an order that
 * failed after payment (`refund_state = 'due'`), then marks it done.
 *
 * Safe to call any number of times, from anywhere: it only acts on orders
 * that are still due, and the provider call is idempotent per order. When it
 * fails, the order stays due and the every-minute cron tries again.
 */
export const makeRefunder = (orders: Orders["Service"], payments: Payments["Service"]) =>
  Effect.fn("Refunds.refund")(function* (orderId: OrderId) {
    const order = yield* orders.get(orderId);
    if (order.refundState !== "due") return order.refundState;
    const attempts = yield* orders.noteRefundAttempt(orderId);

    const outcome = yield* payments
      .refund({ orderId, reason: `Ranked by Jev could not judge ${order.siteKey}: ${order.error ?? "no verdict"}` })
      .pipe(
        Effect.tapError((error: PaymentError) =>
          attempts >= STUCK_REFUND_ATTEMPTS
            ? Effect.logError("Refund still failing", { orderId, attempts, error: error.message })
            : Effect.logWarning("Refund failed; the cron will retry", { orderId, attempts, error: error.message }),
        ),
      );

    if (outcome === "nothing_to_refund") {
      if (attempts < MISSING_PAYMENT_ATTEMPTS) {
        yield* Effect.logWarning("No payment found to refund yet", { orderId, attempts });
        return "due" satisfies RefundState;
      }
      yield* Effect.logError("No payment found to refund; closing the refund", { orderId, attempts });
    }
    yield* orders.markRefunded(orderId);
    yield* Effect.logInfo("Order refunded", { orderId, outcome, attempts });
    yield* track("refund_issued", { order_id: orderId, site: order.siteKey, outcome, attempts }, { distinctId: order.customerId });
    return "done" satisfies RefundState;
  });

export type Refunder = ReturnType<typeof makeRefunder>;
