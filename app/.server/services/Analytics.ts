import { Context, Effect, Layer, Option } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { AppConfig } from "../config";

/**
 * Who server-side events belong to: the visitor (their `jev_vid`, which the
 * browser SDK also uses as its distinct id) and, when the browser sent it,
 * their PostHog session, so events line up with the session replay.
 */
export interface Actor {
  readonly distinctId: string | null;
  readonly sessionId: string | null;
  /** Groups LLM generations into one trace (the order id, for a judgment and its tiebreaks). */
  readonly traceId?: string | null;
}

/** The actor for the work in progress: set per request and per queue job. */
export const AnalyticsActor = Context.Reference<Actor>("jevboard/AnalyticsActor", {
  defaultValue: () => ({ distinctId: null, sessionId: null }),
});

/** Server events without a person (cron sweeps, say) go under this id. */
const SERVER_DISTINCT_ID = "rankedbyjev-server";

/** A batch this big is sent straight away rather than waiting for the end of the request. */
const MAX_BUFFERED = 50;

interface CapturedEvent {
  readonly event: string;
  readonly distinct_id: string;
  readonly properties: Record<string, unknown>;
  readonly timestamp: string;
}

/**
 * Product analytics from the server: the funnel steps the browser can't see
 * (payment confirmed, judged, failed, refunded) and Jev's model calls as LLM
 * analytics generations.
 *
 * Events are buffered and sent in one batch by `flush`, which the Worker
 * calls after each request, queue batch and cron run. Without a PostHog
 * token everything is a no-op. Sending never fails the caller.
 */
export class Analytics extends Context.Service<
  Analytics,
  {
    /** Queues an event for the current actor (or `distinctId` when given). */
    readonly capture: (
      event: string,
      properties?: Record<string, unknown>,
      options?: { readonly distinctId?: string },
    ) => Effect.Effect<void>;
    /** Sends everything queued so far. */
    readonly flush: Effect.Effect<void>;
  }
>()("jevboard/Analytics") {
  /** Analytics over a caller-supplied HttpClient (tests pass a fake). */
  static readonly layerNoDeps: Layer.Layer<Analytics, never, AppConfig | HttpClient.HttpClient> = Layer.effect(
    Analytics,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const http = yield* HttpClient.HttpClient;
      if (Option.isNone(config.posthog)) {
        return Analytics.of({ capture: () => Effect.void, flush: Effect.void });
      }
      const { token, host } = config.posthog.value;
      const client = http.pipe(HttpClient.filterStatusOk);
      let buffer: Array<CapturedEvent> = [];

      const flush = Effect.suspend(() => {
        if (buffer.length === 0) return Effect.void;
        const batch = buffer;
        buffer = [];
        return client
          .execute(
            HttpClientRequest.post(`${host}/batch/`).pipe(
              HttpClientRequest.bodyJsonUnsafe({ api_key: token, batch }),
            ),
          )
          .pipe(
            Effect.timeout("5 seconds"),
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning("PostHog batch failed", { events: batch.length, error: String(error) }),
            ),
          );
      }).pipe(Effect.withSpan("Analytics.flush"));

      const capture = (event: string, properties: Record<string, unknown> = {}, options?: { readonly distinctId?: string }) =>
        Effect.gen(function* () {
          const actor = yield* AnalyticsActor;
          buffer.push({
            event,
            distinct_id: options?.distinctId ?? actor.distinctId ?? SERVER_DISTINCT_ID,
            properties: {
              $lib: "rankedbyjev-server",
              ...(actor.sessionId ? { $session_id: actor.sessionId } : {}),
              ...(options?.distinctId || actor.distinctId ? {} : { $process_person_profile: false }),
              ...properties,
            },
            timestamp: new Date().toISOString(),
          });
          if (buffer.length >= MAX_BUFFERED) yield* flush;
        });

      return Analytics.of({ capture, flush });
    }),
  );

  static readonly layer: Layer.Layer<Analytics, never, AppConfig> = Analytics.layerNoDeps.pipe(
    Layer.provide(FetchHttpClient.layer),
  );

  /** Records events in memory (tests). */
  static readonly layerRecording = (events: Array<{ event: string; distinctId: string | null; properties: Record<string, unknown> }>) =>
    Layer.succeed(
      Analytics,
      Analytics.of({
        capture: (event, properties = {}, options) =>
          Effect.gen(function* () {
            const actor = yield* AnalyticsActor;
            events.push({ event, distinctId: options?.distinctId ?? actor.distinctId, properties });
          }),
        flush: Effect.void,
      }),
    );
}

/**
 * `Analytics.capture` when the service is around, nothing otherwise, so any
 * flow can record an event without adding a requirement (tests run without it).
 */
export const track = (
  event: string,
  properties?: Record<string, unknown>,
  options?: { readonly distinctId?: string },
): Effect.Effect<void> =>
  Effect.flatMap(Effect.serviceOption(Analytics), (analytics) =>
    Option.isSome(analytics) ? analytics.value.capture(event, properties, options) : Effect.void,
  );
