import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { Payments } from "../Payments";

/**
 * Simulated checkout for local development (no AUTUMN_SECRET_KEY).
 * The buyer is sent to /dev/checkout/:orderId, a fake payment page; pressing
 * "pay" there records the payment in the `fake_payments` table (shared by
 * every Worker isolate, unlike memory). Refunds are recorded there too.
 */
export const FakePaymentsLive = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return Payments.of({
      kind: "fake",
      createCheckout: (input) =>
        Effect.succeed({
          _tag: "Redirect" as const,
          url: `/dev/checkout/${encodeURIComponent(input.orderId)}?return=${encodeURIComponent(input.successUrl)}&cancel=${encodeURIComponent(input.cancelUrl)}`,
        }),
      confirm: ({ orderId }) =>
        sql<{ orderId: string }>`SELECT order_id FROM fake_payments WHERE order_id = ${orderId}`.pipe(
          Effect.map((rows) => (rows.length > 0 ? ("paid" as const) : ("unpaid" as const))),
          Effect.orDie,
        ),
      refund: ({ orderId }) =>
        sql<{ orderId: string }>`
          UPDATE fake_payments SET refunded_at = COALESCE(refunded_at, ${Date.now()})
          WHERE order_id = ${orderId} RETURNING order_id`.pipe(
          Effect.map((rows) => (rows.length > 0 ? ("refunded" as const) : ("nothing_to_refund" as const))),
          Effect.orDie,
        ),
      simulatePayment: (orderId) =>
        sql`INSERT OR IGNORE INTO fake_payments (order_id, paid_at) VALUES (${orderId}, ${Date.now()})`.pipe(
          Effect.asVoid,
          Effect.orDie,
        ),
    });
  }),
);
