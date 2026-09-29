import { Context, Effect, FiberSet, Layer } from "effect";
import type { PaymentError } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import { Orders } from "./Orders";
import { Payments } from "./Payments";
import { Pipeline } from "./Pipeline";

/**
 * Where paid judgments go to be processed.
 *
 * Production (Cloudflare) sends jobs to Queues — see cloudflare/layers.ts:
 * judging jobs run in parallel, placement jobs one at a time. The in-process
 * layer here runs the whole pipeline on a forked fiber (tests, scripts).
 */
export interface JudgmentQueueShape {
  /** Schedules a paid order for judging. Safe to call more than once. */
  readonly enqueue: (orderId: OrderId) => Effect.Effect<void>;
  /**
   * Confirms payment for an unpaid order and enqueues it if paid (used by the
   * judging page, the payment webhook and the cron sweeper). Idempotent.
   */
  readonly settle: (orderId: OrderId, customerId: string) => Effect.Effect<void, PaymentError>;
}

export class JudgmentQueue extends Context.Service<JudgmentQueue, JudgmentQueueShape>()("jevboard/JudgmentQueue") {
  /** Shared `settle` built on top of any `enqueue`. */
  static readonly makeSettle = (enqueue: JudgmentQueueShape["enqueue"]) =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const payments = yield* Payments;
      return Effect.fn("JudgmentQueue.settle")(function* (orderId: OrderId, customerId: string) {
        const paid = yield* payments.confirm({ orderId, customerId });
        if (paid === "paid" && (yield* orders.markPaid(orderId))) yield* enqueue(orderId);
      });
    });

  /** Runs judgments on fibers owned by this layer (interrupted when it closes). */
  static readonly layerInProcess = Layer.effect(
    JudgmentQueue,
    Effect.gen(function* () {
      const pipeline = yield* Pipeline;
      const fibers = yield* FiberSet.make();
      const active = new Set<string>();

      const enqueue = Effect.fn("JudgmentQueue.enqueue")(function* (orderId: OrderId) {
        if (active.has(orderId)) return;
        active.add(orderId);
        yield* FiberSet.run(
          fibers,
          pipeline.run(orderId).pipe(Effect.ensuring(Effect.sync(() => active.delete(orderId)))),
        );
      });

      return JudgmentQueue.of({ enqueue, settle: yield* JudgmentQueue.makeSettle(enqueue) });
    }),
  );
}
