import { env } from "cloudflare:workers";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { CloudflareEnv } from "./cloudflare/env";
import {
  configProviderFor,
  D1Live,
  JudgmentQueueCloudflare,
  RateLimiterCloudflare,
  SqlBatchD1,
} from "./cloudflare/layers";
import { AppConfig } from "./config";
import { TracingLive } from "./observability";
import { Analytics } from "./services/Analytics";
import { Board } from "./services/Board";
import { Experiments } from "./services/Experiments";
import { Previews } from "./services/Previews";
import { CrawlerCloudflare } from "./cloudflare/crawler";
import { JudgeLive } from "./services/judge/JudgeLive";
import { Orders } from "./services/Orders";
import { PaymentsLive } from "./services/payments/PaymentsLive";
import { Pipeline } from "./services/Pipeline";
import { Views } from "./services/Views";

/**
 * The whole backend as one layer graph, running on Cloudflare Workers:
 *
 *   Worker env ─┬─ D1 (SqlClient, atomic batches) ── Board, Orders, Views ────┐
 *               ├─ Crawler ────────────────────────────────────────────────────┼─ Pipeline
 *               ├─ Judge (OpenRouter | mock) ──────────────────────────────────┘
 *               ├─ Payments (Autumn | simulator)
 *               ├─ JudgmentQueue (Cloudflare Queues) · RateLimiter (Rate Limiting bindings)
 *               ├─ Analytics + Tracing (PostHog: events, OTLP spans)
 *               └─ AppConfig (vars + secrets)
 *
 * Loaders, actions, queue consumers and the cron trigger all run on the same
 * per-isolate ManagedRuntime. Only this file and ./cloudflare/* know about
 * Workers; everything else is tested in Node against SQLite.
 */
const Database = SqlBatchD1.pipe(Layer.provideMerge(D1Live));

const Services = Layer.mergeAll(
  Board.layer,
  Orders.layer,
  CrawlerCloudflare,
  JudgeLive,
  PaymentsLive,
  Analytics.layer,
  RateLimiterCloudflare,
  Views.layer,
  Previews.layer,
  Experiments.layer,
).pipe(Layer.provideMerge(Database));

const Jobs = Layer.mergeAll(Pipeline.layer, JudgmentQueueCloudflare).pipe(Layer.provideMerge(Services));

const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return config.env === "production" ? Logger.layer([Logger.consoleJson]) : Logger.layer([Logger.consolePretty()]);
  }),
);

export const AppLayer = Jobs.pipe(
  Layer.provideMerge(TracingLive),
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(AppConfig.layer),
  Layer.provideMerge(Layer.succeed(CloudflareEnv, env)),
  Layer.provide(configProviderFor(env, import.meta.env.MODE)),
);

export type AppServices = Layer.Success<typeof AppLayer>;

/** One runtime per Worker isolate, built lazily on first use. */
export const runtime = ManagedRuntime.make(AppLayer);
