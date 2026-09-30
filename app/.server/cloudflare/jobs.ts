import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { Effect, Exit, Schema } from "effect";
import { OrderId } from "../domain/ids";
import { Pipeline } from "../services/Pipeline";
import { CloudflareEnv, type JudgmentJob } from "./env";
import { reportServerError } from "../report";

const decodeJob = Schema.decodeUnknownOption(Schema.Struct({ orderId: OrderId }));

/**
 * Queue consumer for both queues:
 * - jevboard-judgments: crawl + verdict (parallel), then hand off to placement
 * - jevboard-placements: tiebreak duels + ranking (one at a time)
 * Definitive failures fail (and refund) the order inside the pipeline.
 * Anything that escapes, like a site that isn't answering yet or an isolate
 * shutdown, retries the message with a growing delay; once the retries are
 * spent, `giveUp` fails and refunds the order.
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
    const maxAttempts = placement ? 10 : 5;
    // Judgments wait out a flaky site: 30 s, 1, 2, then 4 minutes (under Pipeline.UNCLAIMED_STALE_MS).
    const delaySeconds = (attempts: number) =>
      placement ? Math.min(120, 10 * 2 ** (attempts - 1)) : Math.min(240, 30 * 2 ** (attempts - 1));

    for (const message of batch.messages) {
      const exit = yield* Effect.exit(process(message));
      if (Exit.isSuccess(exit)) {
        message.ack();
        continue;
      }
      const job = decodeJob(message.body);
      if (message.attempts >= maxAttempts && job._tag === "Some") {
        // Out of retries: fail the order and refund the buyer.
        yield* Effect.logError("Queue job gave up", { queue: batch.queue, attempts: message.attempts }, exit.cause);
        reportServerError(exit.cause, { queue: batch.queue, attempts: message.attempts, orderId: job.value.orderId });
        yield* pipeline.giveUp(job.value.orderId);
        message.ack();
      } else {
        yield* Effect.logWarning("Queue job failed; retrying", { queue: batch.queue, attempts: message.attempts }, exit.cause);
        message.retry({ delaySeconds: delaySeconds(message.attempts) });
      }
    }
  }).pipe(Effect.withSpan("queue", { attributes: { queue: batch.queue, size: batch.messages.length } }));
