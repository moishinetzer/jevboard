import { D1Client } from "@effect/sql-d1";
import { ConfigProvider, Effect, Layer, String as Str } from "effect";
import { SqlBatch } from "../db/SqlBatch";
import { JudgmentQueue } from "../services/JudgmentQueue";
import { RateLimiter } from "../services/RateLimiter";
import { CloudflareEnv, type Env } from "./env";

/**
 * Cloudflare implementations of the infrastructure services. Everything above
 * this layer (repositories, pipeline, flows, routes) is runtime-agnostic and
 * tested in Node against SQLite.
 */

/** D1 as the app's SqlClient (snake_case columns ⇄ camelCase rows). */
export const D1Live = Layer.unwrap(
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    return D1Client.layer({
      db: env.DB,
      transformResultNames: Str.snakeToCamel,
      transformQueryNames: Str.camelToSnake,
    }).pipe(Layer.orDie);
  }),
);

/** Atomic multi-statement writes via `D1Database.batch`. */
export const SqlBatchD1 = Layer.effect(
  SqlBatch,
  Effect.gen(function* () {
    const d1 = yield* D1Client.D1Client;
    return SqlBatch.of({
      run: (statements) =>
        statements.length === 0
          ? Effect.void
          : d1.batch(statements).pipe(
              Effect.asVoid,
              Effect.orDie,
              Effect.withSpan("SqlBatch.run", { attributes: { statements: statements.length } }),
            ),
    });
  }),
);

/** Paid orders become messages on the judgment queue (see cloudflare/jobs.ts). */
export const JudgmentQueueCloudflare = Layer.effect(
  JudgmentQueue,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const enqueue = Effect.fn("JudgmentQueue.enqueue")(function* (orderId: string) {
      yield* Effect.promise(() => env.JUDGMENT_QUEUE.send({ orderId }));
    });
    return JudgmentQueue.of({ enqueue, settle: yield* JudgmentQueue.makeSettle(enqueue) });
  }),
);

/** Workers Rate Limiting bindings; allows everything when a binding is missing. */
export const RateLimiterCloudflare = Layer.effect(
  RateLimiter,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    return RateLimiter.of({
      allow: (bucket, key) => {
        const binding = bucket === "visitor" ? env.VISITOR_LIMITER : bucket === "preview" ? env.PREVIEW_LIMITER : env.IP_LIMITER;
        if (!binding) return Effect.succeed(true);
        return Effect.promise(() => binding.limit({ key: `${bucket}:${key}` })).pipe(
          Effect.map((outcome) => outcome.success),
          Effect.catchDefect(() => Effect.succeed(true)),
        );
      },
    });
  }),
);

/**
 * Config comes from the Worker's string vars and secrets. NODE_ENV follows the
 * Vite build mode, so `vite dev` is development and deployed builds are production.
 */
export const configProviderFor = (env: Env, mode: string) => {
  const record: Record<string, string> = { NODE_ENV: mode === "production" ? "production" : "development" };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") record[key] = value;
  }
  return ConfigProvider.layer(ConfigProvider.fromEnvRecord(record));
};

