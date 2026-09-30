import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";
import { AppConfig } from "./config";
import { Analytics } from "./services/Analytics";

/**
 * Every Effect span (each loader and action, crawls, Jev's calls, payments,
 * queue jobs) exported to PostHog Tracing over OTLP/HTTP protobuf. Spans that
 * carry `posthogDistinctId` / `sessionId` attributes link to the person and
 * their session replay. Without a PostHog token nothing is exported.
 */
export const TracingLive: Layer.Layer<OtlpExporter.Flusher, never, AppConfig> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isNone(config.posthog)) return OtlpExporter.layerFlusher;
    const { token, host } = config.posthog.value;
    return OtlpTracer.layer({
      url: `${host}/i/v1/traces`,
      headers: { authorization: `Bearer ${token}` },
      resource: { serviceName: "rankedbyjev", attributes: { "deployment.environment": config.env } },
      exportInterval: "2 seconds",
      shutdownTimeout: "3 seconds",
    }).pipe(Layer.provide(OtlpSerialization.layerProtobuf), Layer.provide(FetchHttpClient.layer));
  }),
);

/**
 * Sends buffered spans and analytics events. Workers freeze an isolate once
 * its response is out, so the Worker runs this in `waitUntil` after every
 * request, queue batch and cron run. Never fails; gives up after a few seconds.
 */
export const flushTelemetry = Effect.gen(function* () {
  const flusher = yield* OtlpExporter.Flusher;
  const analytics = yield* Analytics;
  yield* Effect.all([analytics.flush, flusher.flush], { concurrency: 2, discard: true });
}).pipe(Effect.timeoutOption("4 seconds"), Effect.asVoid);
