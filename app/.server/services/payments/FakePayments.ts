import { Effect, Layer } from "effect";
import { Payments } from "../Payments";

declare global {
  // Survives dev-server HMR so a simulated payment isn't forgotten mid-flow.
  var __jevFakePaid: Set<string> | undefined;
}

/**
 * Simulated checkout for local development (no AUTUMN_SECRET_KEY).
 * The buyer is sent to /dev/checkout/:orderId, a fake payment page; pressing
 * "pay" there marks the order paid in memory.
 */
export const FakePaymentsLive = Layer.sync(Payments, () => {
  const paid = (globalThis.__jevFakePaid ??= new Set<string>());
  return Payments.of({
    kind: "fake",
    createCheckout: (input) =>
      Effect.succeed({
        _tag: "Redirect" as const,
        url: `/dev/checkout/${encodeURIComponent(input.orderId)}?return=${encodeURIComponent(input.successUrl)}`,
      }),
    confirm: ({ orderId }) => Effect.sync(() => (paid.has(orderId) ? ("paid" as const) : ("unpaid" as const))),
    simulatePayment: (orderId) => Effect.sync(() => void paid.add(orderId)),
  });
});
