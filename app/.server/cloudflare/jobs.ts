import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { Effect, Exit, Schema } from "effect";
import { OrderId } from "../domain/ids";
import { Pipeline } from "../services/Pipeline";
import { CloudflareEnv, type JudgmentJob } from "./env";

const decodeJob = Schema.decodeUnknownOption(Schema.Struct({ orderId: OrderId }));

/**
 * Queue consumer for both queues:
 * - jevboard-judgments: crawl + verdict (parallel), then hand off to placement
 * - jevboard-placements: tiebreak duels + ranking (one at a time)
 * Handled failures mark the order failed inside the pipeline; anything that
 * escapes (e.g. isolate shutdown) retries the message.
 */
export const handleQueueBatch = (batch: MessageBatch<JudgmentJob>) =>
  Effect.gen(function* () {
    const pipeline = yield* Pipeline;
    const env = yield* CloudflareEnv;
    const placement = batch.queue.endsWith("placements");

    const process = (message: Message<JudgmentJob>) =>
      Effect.gen(function* () {
        const job = decodeJob(message.body);
        if (job._tag === "None") {
          yield* Effect.logWarning("Dropping malformed queue message", { queue: batch.queue });
          return;
        }
        const orderId = job.value.orderId;
        if (placement) {
          yield* pipeline.place(orderId);
        } else if ((yield* pipeline.judge(orderId)) === "judged") {
          yield* Effect.promise(() => env.PLACEMENT_QUEUE.send({ orderId }));
        }
      });

    // Keep in sync with max_retries in wrangler.jsonc.
    const maxAttempts = placement ? 10 : 3;

    for (const message of batch.messages) {
      const exit = yield* Effect.exit(process(message));
      if (Exit.isSuccess(exit)) {
        message.ack();
        continue;
      }
      const job = decodeJob(message.body);
      if (message.attempts >= maxAttempts && job._tag === "Some") {
        // Out of retries: fail the order so the buyer can ask again for free.
        yield* Effect.logError("Queue job gave up", { queue: batch.queue, attempts: message.attempts }, exit.cause);
        yield* pipeline.giveUp(job.value.orderId);
        message.ack();
      } else {
        yield* Effect.logWarning("Queue job failed; retrying", { queue: batch.queue, attempts: message.attempts }, exit.cause);
        message.retry({ delaySeconds: Math.min(120, 10 * 2 ** (message.attempts - 1)) });
      }
    }
  }).pipe(Effect.withSpan("queue", { attributes: { queue: batch.queue, size: batch.messages.length } }));
