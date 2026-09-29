import { Effect, Layer } from "effect";
import { PaymentError } from "../../domain/errors";
import { Payments } from "../Payments";

// PLACEHOLDER — replaced by the real Autumn implementation.
export const AutumnPaymentsLive = Layer.succeed(
  Payments,
  Payments.of({
    kind: "autumn",
    createCheckout: () => Effect.fail(new PaymentError({ message: "not implemented" })),
    confirm: () => Effect.fail(new PaymentError({ message: "not implemented" })),
  }),
);
