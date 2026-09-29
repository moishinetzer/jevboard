import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { AppConfig } from "./config";
import { DatabaseLive } from "./db/Database";
import { Board } from "./services/Board";
import { CrawlerLive } from "./services/crawler/CrawlerLive";
import { JudgeLive } from "./services/judge/JudgeLive";
import { JudgmentQueue } from "./services/JudgmentQueue";
import { Orders } from "./services/Orders";
import { PaymentsLive } from "./services/payments/PaymentsLive";
import { Pipeline } from "./services/Pipeline";
import { Presence } from "./services/Presence";
import { RateLimiter } from "./services/RateLimiter";

/**
 * The whole backend as one layer graph:
 *
 *   AppConfig ─┬─ Database ── Board, Orders ─┐
 *              ├─ Crawler ───────────────────┼─ Pipeline ── JudgmentQueue (workers)
 *              ├─ Judge (Claude | mock) ─────┘
 *              └─ Payments (Autumn | simulator)
 *
 * Layers are memoized by reference, so every consumer shares one SQLite
 * connection and one queue.
 */
const Repositories = Layer.mergeAll(Board.layer, Orders.layer).pipe(Layer.provide(DatabaseLive));

const Providers = Layer.mergeAll(CrawlerLive, JudgeLive, PaymentsLive);

const Workers = JudgmentQueue.layer.pipe(
  Layer.provide(Pipeline.layer),
  Layer.provide(Layer.mergeAll(Repositories, Providers)),
);

const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return config.env === "production" ? Logger.layer([Logger.consoleJson]) : Logger.layer([Logger.consolePretty()]);
  }),
);

export const AppLayer = Layer.mergeAll(Workers, Repositories, Providers, Presence.layer, RateLimiter.layer).pipe(
  Layer.provideMerge(LoggerLive),
  Layer.provideMerge(AppConfig.layer),
);

export type AppServices = Layer.Success<typeof AppLayer>;

declare global {
  var __jevRuntime: ManagedRuntime.ManagedRuntime<AppServices, Layer.Error<typeof AppLayer>> | undefined;
}

/**
 * One runtime per server process. When Vite re-evaluates this module in dev
 * (because backend code changed), the previous runtime is disposed first:
 * its workers are interrupted and any in-flight order is recovered by the new
 * runtime's queue on boot.
 */
const previous = globalThis.__jevRuntime;
if (previous) void previous.dispose();

export const runtime = ManagedRuntime.make(AppLayer);
globalThis.__jevRuntime = runtime;

// Boot eagerly so crash-recovered judgments resume without waiting for traffic.
if (process.env.NODE_ENV !== "test") {
  runtime.runPromise(Effect.logInfo("Jevboard backend ready")).catch((error: unknown) => {
    console.error("Failed to start the Jevboard backend", error);
  });
}

declare global {
  var __jevShutdownHook: boolean | undefined;
}

// Drain on shutdown: interrupt workers (their orders stay in flight and are
// recovered on the next boot) and close SQLite cleanly. Registered once.
if (!globalThis.__jevShutdownHook) {
  globalThis.__jevShutdownHook = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      const current = globalThis.__jevRuntime;
      void (current ? current.dispose() : Promise.resolve()).finally(() => process.exit(0));
    });
  }
}
