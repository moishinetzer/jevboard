import { Effect, Layer, Option } from "effect";
import { AppConfig } from "../../config";
import { MockJudgeLive } from "./MockJudge";
import { OpenRouterJudgeLive } from "./OpenRouterJudge";

/** Real Jev (through OpenRouter) when OPENROUTER_API_KEY is configured, mock Jev otherwise. */
export const JudgeLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isSome(config.openrouter)) return OpenRouterJudgeLive;
    yield* Effect.logWarning("OPENROUTER_API_KEY not set — using mock Jev (deterministic fake verdicts).");
    return MockJudgeLive;
  }),
);
