import { type Duration, Effect, flow, Option, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

/**
 * Minimal Autumn REST client (API 2.4.0, RPC style: `POST /v1/<namespace>.<method>`).
 *
 * We call REST directly instead of wrapping `autumn-js` so the HTTP status is
 * always visible (Autumn's `check`/`track` "fail open" with 202, and the SDK
 * fakes `allowed: true` on 5xx) and so nothing retries or fails open behind
 * our back. See docs/payments.md.
 */

/** A failed Autumn call. `status` is absent when no HTTP response arrived (network error, timeout). */
export class AutumnError extends Schema.TaggedError<AutumnError>()("AutumnError", {
  endpoint: Schema.String,
  status: Schema.optional(Schema.Number),
  /** Autumn's machine-readable code, e.g. `customer_not_found`, `duplicate_idempotency_key`. */
  code: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export interface AutumnClientOptions {
  readonly secretKey: Redacted.Redacted<string>;
  /** e.g. https://api.useautumn.com/v1 */
  readonly apiUrl: string;
  /** Sent as `x-api-version`; response shapes depend on it. */
  readonly apiVersion: string;
  /** Backoff for retryable failures (see `isRetryable`). Tests pass a zero-delay schedule. */
  readonly retrySchedule?: Schedule.Schedule<unknown, AutumnError> | undefined;
  /** Per-attempt timeout. */
  readonly timeout?: Duration.Input | undefined;
}

/** A 2xx answer. `body` is the parsed JSON (undefined when empty or not JSON). */
export interface AutumnReply {
  readonly status: number;
  readonly body: unknown;
}

export interface AutumnClient {
  /**
   * `POST {apiUrl}/{endpoint}` with a JSON body. Succeeds for any 2xx; any
   * other status fails with `AutumnError` carrying Autumn's `code`/`message`.
   * Retryable failures are retried with backoff before surfacing.
   */
  readonly post: (
    endpoint: string,
    body: unknown,
    options?: { readonly idempotencyKey?: string | undefined },
  ) => Effect.Effect<AutumnReply, AutumnError>;
}

/**
 * Transient conditions worth a short retry: no response at all, 423 (another
 * attach for this customer holds the lock), 429 (rate limit), 503 (load
 * shedding) and gateway errors. Every call we make is safe to repeat: reads,
 * `get_or_create`, a deterministic `billing.attach` body (Autumn returns the
 * same checkout session) and `track` behind an Idempotency-Key.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 423, 429, 500, 502, 503, 504]);
export const isRetryable = (error: AutumnError): boolean =>
  error.status === undefined || RETRYABLE_STATUSES.has(error.status);

/** ~0.5s, 1s, 2s (jittered): three retries, a few seconds in total. */
export const defaultRetrySchedule: Schedule.Schedule<unknown, AutumnError> = Schedule.max([
  Schedule.exponential("500 millis").pipe(Schedule.jittered),
  Schedule.recurs(3),
]);

const DEFAULT_TIMEOUT: Duration.Input = "10 seconds";

/** Autumn echoes (masked) keys in some errors; never let one reach a log or a message. */
const KEY_PATTERN = /\bam_(sk|pk)_[A-Za-z0-9_]+/g;
export const scrubSecrets = (text: string): string => text.replace(KEY_PATTERN, "am_$1_***").slice(0, 500);

const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** Autumn error body: `{ message, code, env }`. Decoded leniently. */
const ErrorBody = Schema.Struct({
  message: Schema.optional(Schema.NullOr(Schema.String)),
  code: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

const statusError = (endpoint: string, status: number, text: string, json: Option.Option<unknown>): AutumnError => {
  const parsed = Option.flatMap(json, decodeErrorBody);
  const code = Option.flatMap(parsed, (body) => Option.fromNullishOr(body.code));
  const message = Option.flatMap(parsed, (body) => Option.fromNullishOr(body.message));
  return new AutumnError({
    endpoint,
    status,
    ...(Option.isSome(code) ? { code: code.value } : {}),
    message: scrubSecrets(Option.getOrElse(message, () => text.trim() || `HTTP ${status}`)),
  });
};

export const makeAutumnClient = (http: HttpClient.HttpClient, options: AutumnClientOptions): AutumnClient => {
  const baseUrl = options.apiUrl.replace(/\/+$/, "");
  const retrySchedule = options.retrySchedule ?? defaultRetrySchedule;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // The Authorization header is redacted by Effect's HTTP tracing
  // (Headers.CurrentRedactedNames) and never appears in AutumnError messages.
  const client = http.pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.bearerToken(options.secretKey),
        HttpClientRequest.setHeader("x-api-version", options.apiVersion),
        HttpClientRequest.acceptJson,
      ),
    ),
  );

  const post = Effect.fn("AutumnClient.post")(
    function* (endpoint: string, body: unknown, callOptions?: { readonly idempotencyKey?: string | undefined }) {
      yield* Effect.annotateCurrentSpan({ "autumn.endpoint": endpoint });
      const base = HttpClientRequest.post(`${baseUrl}/${endpoint}`).pipe(HttpClientRequest.bodyJsonUnsafe(body));
      const request = callOptions?.idempotencyKey
        ? HttpClientRequest.setHeader(base, "Idempotency-Key", callOptions.idempotencyKey)
        : base;

      const attempt = client.execute(request).pipe(
        Effect.flatMap((response) => Effect.map(response.text, (text) => ({ status: response.status, text }))),
        Effect.timeout(timeout),
        Effect.mapError(
          (error) =>
            new AutumnError({
              endpoint,
              message:
                error._tag === "TimeoutError" ? "Autumn did not answer in time" : scrubSecrets(error.message),
            }),
        ),
        Effect.flatMap(({ status, text }) => {
          const json = text.length > 0 ? parseJson(text) : Option.none();
          return status >= 200 && status < 300
            ? Effect.succeed<AutumnReply>({ status, body: Option.getOrUndefined(json) })
            : Effect.fail(statusError(endpoint, status, text, json));
        }),
        Effect.tapError((error) =>
          isRetryable(error)
            ? Effect.logDebug("Autumn call failed, may retry", {
                endpoint,
                status: error.status,
                code: error.code,
                message: error.message,
              })
            : Effect.void,
        ),
      );

      const reply = yield* attempt.pipe(Effect.retry({ schedule: retrySchedule, while: isRetryable }));
      yield* Effect.annotateCurrentSpan({ "autumn.status": reply.status });
      return reply;
    },
  );

  return { post };
};

/** Decodes a 2xx body, turning an unexpected shape into an `AutumnError` (never a silent success). */
export const decodeReply =
  <A>(schema: Schema.ConstraintDecoder<A>, endpoint: string) =>
  (reply: AutumnReply): Effect.Effect<A, AutumnError> =>
    Schema.decodeUnknownEffect(schema)(reply.body).pipe(
      Effect.mapError(
        (error) =>
          new AutumnError({
            endpoint,
            status: reply.status,
            message: `Unexpected Autumn response: ${error.message}`.slice(0, 500),
          }),
      ),
    );
