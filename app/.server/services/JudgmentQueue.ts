import { Context, Effect, Layer, Queue, Schedule } from "effect";
import { AppConfig } from "../config";
import type { PaymentError } from "../domain/errors";
import type { OrderId } from "../domain/ids";
import { Orders } from "./Orders";
import { Payments } from "./Payments";
import { Pipeline } from "./Pipeline";

/** Unpaid orders older than this are no longer swept (checkout sessions expire after ~1h). */
const SWEEP_WINDOW_MS = 26 * 60 * 60 * 1000;

/**
 * In-process job queue for paid judgments.
 *
 * A fixed pool of worker fibers (JEV_WORKERS) is forked into the layer's
 * scope, so they live exactly as long as the runtime. On boot, every order
 * left in flight by a previous process is re-enqueued — a paid judgment is
 * never lost to a deploy or crash.
 *
 * A payment sweeper also runs every minute: buyers who paid and closed the tab
 * before returning to /judging/:orderId still get judged.
 */
export class JudgmentQueue extends Context.Service<
  JudgmentQueue,
  {
    /** Schedules an order for processing. No-op if it's already queued or running. */
    readonly enqueue: (orderId: OrderId) => Effect.Effect<void>;
    /** Number of orders waiting or running in this process. */
    readonly pending: Effect.Effect<number>;
    /**
     * Confirms payment for an unpaid order and queues it if paid (used by the
     * payment webhook and the sweeper). Idempotent.
     */
    readonly settle: (orderId: OrderId, customerId: string) => Effect.Effect<void, PaymentError>;
  }
>()("jevboard/JudgmentQueue") {
  static readonly layer = Layer.effect(
    JudgmentQueue,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const orders = yield* Orders;
      const pipeline = yield* Pipeline;
      const payments = yield* Payments;
      const queue = yield* Queue.unbounded<OrderId>();
      const active = new Set<string>();

      const worker = (id: number) =>
        Queue.take(queue).pipe(
          Effect.flatMap((orderId) =>
            pipeline.run(orderId).pipe(Effect.ensuring(Effect.sync(() => active.delete(orderId)))),
          ),
          Effect.forever,
          Effect.annotateLogs({ worker: id }),
        );

      for (let id = 1; id <= config.workers; id++) {
        yield* Effect.forkScoped(worker(id));
      }

      const enqueue = Effect.fn("JudgmentQueue.enqueue")(function* (orderId: OrderId) {
        if (active.has(orderId)) return;
        active.add(orderId);
        yield* Queue.offer(queue, orderId);
      });

      /** Confirms payment for one unpaid order and queues it. Safe to call repeatedly. */
      const settle = Effect.fn("JudgmentQueue.settle")(function* (orderId: OrderId, customerId: string) {
        const paid = yield* payments.confirm({ orderId, customerId });
        if (paid === "paid" && (yield* orders.markPaid(orderId))) yield* enqueue(orderId);
      });

      const sweep = Effect.gen(function* () {
        const unpaid = yield* orders.awaitingPayment(Date.now() - SWEEP_WINDOW_MS);
        for (const order of unpaid) {
          yield* settle(order.id, order.customerId).pipe(
            Effect.catchTag("PaymentError", (error) => Effect.logDebug("Sweeper: payment check failed", error)),
          );
        }
      }).pipe(Effect.withSpan("JudgmentQueue.sweep"));

      yield* sweep.pipe(
        Effect.catchCause((cause) => Effect.logWarning("Payment sweep failed", cause)),
        Effect.repeat(Schedule.spaced("1 minute")),
        Effect.delay("30 seconds"),
        Effect.forkScoped,
      );

      const recovered = yield* orders.inFlight;
      for (const order of recovered) yield* enqueue(order.id);
      if (recovered.length > 0) {
        yield* Effect.logInfo(`Recovered ${recovered.length} in-flight judgment(s)`);
      }

      return JudgmentQueue.of({
        enqueue,
        settle,
        pending: Effect.sync(() => active.size),
      });
    }),
  );
}
