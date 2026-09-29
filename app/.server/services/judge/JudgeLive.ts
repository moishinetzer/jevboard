import { Effect, Layer, Option } from "effect";
import { AppConfig } from "../../config";
import { ClaudeJudgeLive } from "./ClaudeJudge";
import { MockJudgeLive } from "./MockJudge";

/** Real Jev when ANTHROPIC_API_KEY is configured, mock Jev otherwise. */
export const JudgeLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isSome(config.anthropic)) return ClaudeJudgeLive;
    yield* Effect.logWarning("ANTHROPIC_API_KEY not set — using mock Jev (deterministic fake verdicts).");
    return MockJudgeLive;
  }),
);
