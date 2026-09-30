import { Effect, Option } from "effect";
import type { BoardEntry, Judgment, Order, OrderStatus } from "../domain/models";
import { Board } from "../services/Board";
import { JudgmentQueue } from "../services/JudgmentQueue";
import { Orders } from "../services/Orders";
import { Payments } from "../services/Payments";
import { track } from "../services/Analytics";

/** Everything the judging page (/judging/:orderId) renders. */
export interface JudgingView {
  readonly order: Pick<
    Order,
    | "id"
    | "siteKey"
    | "url"
    | "kind"
    | "status"
    | "stageDetail"
    | "error"
    | "createdAt"
    | "paidAt"
    | "completedAt"
    | "refundState"
    | "refundedAt"
  >;
  /** Ordered pipeline steps with their state, for the progress UI. */
  readonly steps: ReadonlyArray<{ readonly key: OrderStatus; readonly label: string; readonly state: "done" | "active" | "todo" | "failed" }>;
  readonly done: boolean;
  /** Present once the order is complete. */
  readonly result: {
    readonly judgment: Judgment;
    /** None when Jev declined to list the site. */
    readonly entry: BoardEntry | null;
    /** For a new #2 or #3: the names of the businesses still ahead of it. */
    readonly above: ReadonlyArray<string>;
    readonly totalEntries: number;
  } | null;
}

const STEPS: ReadonlyArray<{ readonly key: OrderStatus; readonly label: string }> = [
  { key: "pending_payment", label: "Payment" },
  { key: "crawling", label: "Crawling" },
  { key: "judging", label: "Judging" },
  { key: "tiebreaking", label: "Placing" },
  { key: "complete", label: "Verdict" },
];

const stepIndex = (status: OrderStatus): number => {
  switch (status) {
    case "pending_payment":
      return 0;
    case "paid":
    case "crawling":
      return 1;
    case "judging":
      return 2;
    case "tiebreaking":
      return 3;
    case "complete":
      return 5;
    case "failed":
      return -1;
  }
};

/** The page polls every ~1.5 s; ask the payment provider at most every few seconds per order (per isolate). */
const PAYMENT_CHECK_INTERVAL_MS = 4000;
const lastPaymentCheck = new Map<string, number>();
const shouldCheckPayment = (orderId: string): boolean => {
  const now = Date.now();
  if (now - (lastPaymentCheck.get(orderId) ?? 0) < PAYMENT_CHECK_INTERVAL_MS) return false;
  if (lastPaymentCheck.size > 5000) lastPaymentCheck.clear();
  lastPaymentCheck.set(orderId, now);
  return true;
};

/**
 * Loads an order for the judging page. When the buyer lands here from
 * checkout, this is also where payment is confirmed (one credit consumed,
 * idempotently) and the judgment is queued.
 */
export const loadJudging = Effect.fn("loadJudging")(function* (orderId: string) {
  const orders = yield* Orders;
  const queue = yield* JudgmentQueue;
  let order = yield* orders.get(orderId);

  if (order.status === "pending_payment" && shouldCheckPayment(order.id)) {
    const payments = yield* Payments;
    const paid = yield* payments.confirm({ orderId: order.id, customerId: order.customerId }).pipe(
      Effect.catchTag("PaymentError", (error) =>
        Effect.logWarning("Payment confirmation failed", error).pipe(Effect.as("unpaid" as const)),
      ),
    );
    if (paid === "paid") {
      if (yield* orders.markPaid(order.id)) {
        yield* track(
          "payment_confirmed",
          { order_id: order.id, site: order.siteKey, kind: order.kind, via: "return" },
          { distinctId: order.customerId },
        );
      }
      yield* queue.enqueue(order.id);
      order = yield* orders.get(orderId);
    }
  }
  // In-flight orders are the queues' job; the cron trigger re-queues any that stall.

  const board = yield* Board;
  let result: JudgingView["result"] = null;
  if (order.status === "complete" && order.judgmentId) {
    const judgment = yield* board.judgment(order.judgmentId);
    if (Option.isSome(judgment)) {
      const entry = Option.getOrNull(yield* board.findBySiteKey(order.siteKey));
      const above = entry && entry.rank > 1 && entry.rank <= 3 ? (yield* board.top(entry.rank - 1)).map((e) => e.name) : [];
      const stats = yield* board.stats;
      result = {
        judgment: judgment.value,
        entry,
        above,
        totalEntries: stats.entries,
      };
    }
  }

  const current = stepIndex(order.status);
  const failedAt = order.status === "failed" ? Math.max(1, order.paidAt ? 2 : 0) : -1;
  const steps = STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    state:
      order.status === "failed"
        ? index < failedAt
          ? ("done" as const)
          : index === failedAt
            ? ("failed" as const)
            : ("todo" as const)
        : index < current
          ? ("done" as const)
          : index === current
            ? ("active" as const)
            : ("todo" as const),
  }));

  return {
    order: {
      id: order.id,
      siteKey: order.siteKey,
      url: order.url,
      kind: order.kind,
      status: order.status,
      stageDetail: order.stageDetail,
      error: order.error,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      completedAt: order.completedAt,
      refundState: order.refundState,
      refundedAt: order.refundedAt,
    },
    steps,
    done: order.status === "complete" || order.status === "failed",
    result,
  } satisfies JudgingView;
});
