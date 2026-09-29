import { Effect, Layer } from "effect";
import { JudgeError } from "../../domain/errors";
import { Judge } from "../Judge";

// PLACEHOLDER — replaced by the real Claude-backed judge.
export const ClaudeJudgeLive = Layer.succeed(
  Judge,
  Judge.of({
    kind: "claude",
    judge: () => Effect.fail(new JudgeError({ reason: "config", message: "not implemented", retryable: false })),
    duel: () => Effect.fail(new JudgeError({ reason: "config", message: "not implemented", retryable: false })),
  }),
);
