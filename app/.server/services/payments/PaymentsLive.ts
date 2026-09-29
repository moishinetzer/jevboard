import { Effect, Layer, Option } from "effect";
import type { SqlClient } from "effect/sql";
import { AppConfig } from "../../config";
import type { Payments } from "../Payments";
import { AutumnPaymentsLive } from "./AutumnPayments";
import { FakePaymentsLive } from "./FakePayments";

/** Autumn when AUTUMN_SECRET_KEY is configured, the checkout simulator otherwise. */
export const PaymentsLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isSome(config.autumn)) return AutumnPaymentsLive as Layer.Layer<Payments, never, AppConfig | SqlClient.SqlClient>;
    yield* Effect.logWarning("AUTUMN_SECRET_KEY not set — payments are SIMULATED (no money moves).");
    return FakePaymentsLive;
  }),
);
