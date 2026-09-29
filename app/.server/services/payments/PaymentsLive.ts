import { Effect, Layer, Option } from "effect";
import { AppConfig } from "../../config";
import { AutumnPaymentsLive } from "./AutumnPayments";
import { FakePaymentsLive } from "./FakePayments";

/** Autumn when AUTUMN_SECRET_KEY is configured, the local checkout simulator otherwise. */
export const PaymentsLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isSome(config.autumn)) return AutumnPaymentsLive;
    yield* Effect.logWarning("AUTUMN_SECRET_KEY not set — payments are SIMULATED (no money moves).");
    return FakePaymentsLive;
  }),
);
