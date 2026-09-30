import { Effect, flow, Layer, Option, Redacted, Result, Schedule, Schema } from "effect";
import { toCodecOpenAI } from "effect/ai/OpenAiStructuredOutput";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { AppConfig, type Effort } from "../../config";
import { JudgeError } from "../../domain/errors";
import { CATEGORIES, DuelVerdict, Verdict } from "../../domain/models";
import { type DuelInput, Judge, type JudgeInput, type JudgeResult } from "../Judge";
import { buildDuelUserMessage, buildJudgeUserMessage, DUEL_SYSTEM_PROMPT, JUDGE_SYSTEM_PROMPT } from "./prompts";
import { evidenceCorpus, verifyReceipts } from "./receipts";

/**
 * The real Jev, on whichever model OpenRouter serves: one chat completion per
 * verdict and one per duel, each constrained to a JSON schema. Jev judges from
 * the crawler snapshot alone (homepage plus a few same-site pages), which keeps
 * a judgment to a single, cheap request.
 *
 * Request shape:
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   { model, max_tokens,
 *     messages: [{ role: "system", content: JUDGE_SYSTEM_PROMPT }, { role: "user", content: <case + untrusted snapshot> }],
 *     response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema } },
 *     reasoning: { effort, exclude: true },   // left out when the effort is "none"
 *     provider: { require_parameters: true } } // only providers that honour every parameter above
 */

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterJudgeSettings {
  readonly apiKey: Redacted.Redacted<string>;
  readonly model: string;
  readonly judgeEffort: Effort;
  readonly duelEffort: Effort;
  /** Public origin, sent as HTTP-Referer for OpenRouter's app attribution. */
  readonly referer?: string | undefined;
  /** Backoff for transient failures (429, 5xx, network). Tests pass a zero-delay schedule. */
  readonly retrySchedule?: Schedule.Schedule<unknown, JudgeError> | undefined;
}

export const LIMITS = {
  /** Reasoning counts toward max_tokens; only generated tokens are billed. */
  judgeMaxTokens: 16_000,
  duelMaxTokens: 4_000,
  judgeTimeout: "4 minutes",
  duelTimeout: "90 seconds",
} as const;

/** ~1s, 2s (jittered): two quick retries for transient failures, then the queue takes over. */
const defaultRetrySchedule: Schedule.Schedule<unknown, JudgeError> = Schedule.max([
  Schedule.exponential("1 second").pipe(Schedule.jittered),
  Schedule.recurs(2),
]);

const verdictOutput = toCodecOpenAI(Verdict);
const duelOutput = toCodecOpenAI(DuelVerdict);

/** JSON schemas sent as `response_format` (constraints like 1-1000 are enforced by the codecs instead). */
export const VERDICT_JSON_SCHEMA: { readonly [key: string]: unknown } = verdictOutput.jsonSchema;
export const DUEL_JSON_SCHEMA: { readonly [key: string]: unknown } = duelOutput.jsonSchema;

const decodeVerdict = Schema.decodeUnknownEffect(verdictOutput.codec);
const decodeDuel = Schema.decodeUnknownEffect(duelOutput.codec);
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

type ReasoningEffort = Exclude<Effort, "none">;

export interface ChatRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }>;
  readonly response_format: {
    readonly type: "json_schema";
    readonly json_schema: { readonly name: string; readonly strict: true; readonly schema: { readonly [key: string]: unknown } };
  };
  readonly reasoning?: { readonly effort: ReasoningEffort; readonly exclude: true };
  readonly provider: { readonly require_parameters: true };
}

const ErrorObject = Schema.Struct({
  code: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The parts of an OpenRouter chat completion Jev reads. Decoded leniently: extra fields are ignored. */
const ChatResponse = Schema.Struct({
  model: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(ErrorObject),
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
        error: Schema.optional(ErrorObject),
        message: Schema.optional(
          Schema.Struct({
            content: Schema.optional(Schema.NullOr(Schema.String)),
            refusal: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    ),
  ),
  usage: Schema.optional(
    Schema.Struct({
      prompt_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
      completion_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
      /** Credits charged for this request (1 credit = $1). */
      cost: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
});
type ChatResponse = typeof ChatResponse.Type;
const decodeChatResponse = Schema.decodeUnknownOption(ChatResponse);
const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ error: ErrorObject }));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** OpenRouter echoes (masked) keys in some errors; never let one reach a log or an order. */
const KEY_PATTERN = /\bsk-or-[A-Za-z0-9_-]+/g;
const scrub = (text: string): string => text.replace(KEY_PATTERN, "sk-or-***").slice(0, 500);

/**
 * HTTP status -> JudgeError. 401/402 are configuration problems (bad key, no
 * credits); 403 means OpenRouter's moderation flagged the input, which a retry
 * won't change; 408, 429 and 5xx are transient.
 */
export const statusToJudgeError = (status: number, message: string): JudgeError => {
  const text = `OpenRouter error (${status}): ${scrub(message)}`;
  if (status === 401 || status === 402) return new JudgeError({ reason: "config", message: text, retryable: false });
  if (status === 403) return new JudgeError({ reason: "refused", message: text, retryable: false });
  const retryable = status === 408 || status === 429 || status >= 500;
  return new JudgeError({ reason: "api", message: text, retryable });
};

const errorMessage = (error: typeof ErrorObject.Type | undefined, fallback: string): string =>
  error?.message?.trim() || fallback;

// ---------------------------------------------------------------------------
// Reading answers
// ---------------------------------------------------------------------------

/** The answer itself, then the same text without a ```json fence, then its outermost {...}. */
export const answerCandidates = (content: string): Array<string> => {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const braced = start >= 0 && end > start ? unfenced.slice(start, end + 1) : undefined;
  return [...new Set([trimmed, unfenced, braced].filter((text): text is string => text !== undefined && text !== ""))];
};

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((category) => [category.toLowerCase(), category]));

/**
 * Structured outputs don't guarantee the capitalisation of enum strings on
 * every provider ("Developer tools"), and a mismatch would fail the whole
 * verdict. Snap `category` and `contentFlag` to their canonical spelling.
 */
const canonicalizeVerdict = (json: unknown): unknown => {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return json;
  const record = json as Record<string, unknown>;
  const category = typeof record["category"] === "string" ? CATEGORY_BY_KEY.get(record["category"].trim().toLowerCase()) : undefined;
  const contentFlag = typeof record["contentFlag"] === "string" ? record["contentFlag"].trim().toLowerCase() : undefined;
  return { ...record, ...(category ? { category } : {}), ...(contentFlag ? { contentFlag } : {}) };
};

// ---------------------------------------------------------------------------
// Tidying the verdict
// ---------------------------------------------------------------------------

const slug = (label: string): string =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");

const tidyList = (items: ReadonlyArray<string>): Array<string> =>
  [...new Set(items.map((item) => item.trim()).filter((item) => item !== ""))].slice(0, 3);

/** Cosmetic clean-up the schema can't express: trimmed text, a real slug label, at most 3 list items. */
export const normalizeVerdict = (verdict: Verdict, fallbackName: string): Verdict => ({
  ...verdict,
  name: verdict.name.trim() || fallbackName,
  tldr: verdict.tldr.trim(),
  label: slug(verdict.label) || "left-the-bench-speechless",
  verdict: verdict.verdict.trim(),
  reasoning: verdict.reasoning.trim(),
  strengths: tidyList(verdict.strengths),
  weaknesses: tidyList(verdict.weaknesses),
  receipts: tidyList(verdict.receipts),
});

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

const reasoningFor = (effort: Effort): Pick<ChatRequest, "reasoning"> =>
  effort === "none" ? {} : { reasoning: { effort, exclude: true } };

export const makeOpenRouterJudge = (http: HttpClient.HttpClient, settings: OpenRouterJudgeSettings) => {
  const retrySchedule = settings.retrySchedule ?? defaultRetrySchedule;

  // The Authorization header is redacted by Effect's HTTP tracing and never
  // appears in JudgeError messages.
  const client = http.pipe(
    HttpClient.mapRequest(
      flow(
        HttpClientRequest.bearerToken(settings.apiKey),
        HttpClientRequest.setHeader("X-Title", "Jevboard"),
        settings.referer ? HttpClientRequest.setHeader("HTTP-Referer", settings.referer) : (request) => request,
        HttpClientRequest.acceptJson,
      ),
    ),
  );

  /** One chat completion: a 2xx with a decodable body, or a JudgeError. Transient failures are retried. */
  const complete = (body: ChatRequest, label: string) => {
    const attempt = client.execute(HttpClientRequest.post(OPENROUTER_CHAT_URL).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap((response) => Effect.map(response.text, (text) => ({ status: response.status, text }))),
      Effect.mapError(
        (error) => new JudgeError({ reason: "api", message: `OpenRouter unreachable: ${scrub(error.message)}`, retryable: true }),
      ),
      Effect.flatMap(({ status, text }): Effect.Effect<ChatResponse, JudgeError> => {
        const json = text.length > 0 ? parseJson(text) : Option.none();
        if (status < 200 || status >= 300) {
          const error = Option.getOrUndefined(Option.flatMap(json, decodeErrorBody))?.error;
          return Effect.fail(statusToJudgeError(status, errorMessage(error, text.trim() || `HTTP ${status}`)));
        }
        const response = Option.flatMap(json, decodeChatResponse);
        if (Option.isNone(response)) {
          return Effect.fail(
            new JudgeError({ reason: "api", message: `Unexpected OpenRouter response: ${scrub(text)}`, retryable: true }),
          );
        }
        // Errors can also arrive with a 200, e.g. when the provider fails mid-generation.
        const error = response.value.error ?? response.value.choices?.[0]?.error;
        if (error) {
          const code = typeof error.code === "number" ? error.code : 502;
          return Effect.fail(statusToJudgeError(code, errorMessage(error, "provider error")));
        }
        return Effect.succeed(response.value);
      }),
      Effect.tapError((error) =>
        error.retryable ? Effect.logDebug("OpenRouter call failed, may retry", { call: label, message: error.message }) : Effect.void,
      ),
    );
    return attempt.pipe(
      Effect.retry({ schedule: retrySchedule, while: (error) => error.reason === "api" && error.retryable }),
      Effect.tap((response) =>
        Effect.logInfo("Jev usage", {
          call: label,
          model: response.model,
          finishReason: response.choices?.[0]?.finish_reason,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          costUsd: response.usage?.cost,
        }),
      ),
    );
  };

  /** Reads the structured answer out of a completion and decodes it with the given codec. */
  const decodeAnswer = <A>(
    response: ChatResponse,
    decode: (json: unknown) => Effect.Effect<A, Schema.SchemaError>,
    what: string,
    prepare: (json: unknown) => unknown = (json) => json,
  ): Effect.Effect<A, JudgeError> =>
    Effect.gen(function* () {
      const choice = response.choices?.[0];
      const refusal = choice?.message?.refusal?.trim();
      if (refusal || choice?.finish_reason === "content_filter") {
        return yield* new JudgeError({
          reason: "refused",
          message: `The model declined${refusal ? `: ${scrub(refusal)}` : " (content filter)"}`,
          retryable: false,
        });
      }
      if (choice?.finish_reason === "length") {
        return yield* new JudgeError({ reason: "invalid-output", message: `The ${what} was cut off at max_tokens`, retryable: true });
      }
      const candidates = answerCandidates(choice?.message?.content ?? "");
      if (candidates.length === 0) {
        return yield* new JudgeError({ reason: "invalid-output", message: `The model returned no ${what}`, retryable: true });
      }
      let firstError: string | undefined;
      for (const candidate of candidates) {
        const json = parseJson(candidate);
        if (Option.isNone(json)) {
          firstError ??= "not valid JSON";
          continue;
        }
        const result = yield* Effect.result(decode(prepare(json.value)));
        if (Result.isSuccess(result)) return result.success;
        firstError ??= result.failure.message;
      }
      return yield* new JudgeError({
        reason: "invalid-output",
        message: `The ${what} failed validation: ${firstError ?? "unknown error"}`,
        retryable: true,
      });
    });

  const judge = Effect.fn("OpenRouterJudge.judge")(
    function* (input: JudgeInput) {
      yield* Effect.annotateCurrentSpan({ siteKey: input.siteKey, roll: input.roll });
      const response = yield* complete(
        {
          model: settings.model,
          max_tokens: LIMITS.judgeMaxTokens,
          messages: [
            { role: "system", content: JUDGE_SYSTEM_PROMPT },
            { role: "user", content: buildJudgeUserMessage(input) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: VERDICT_JSON_SCHEMA } },
          ...reasoningFor(settings.judgeEffort),
          provider: { require_parameters: true },
        },
        "judge",
      );
      const raw = yield* decodeAnswer(response, decodeVerdict, "verdict", canonicalizeVerdict);
      const receipts = verifyReceipts(raw.receipts, evidenceCorpus(input.snapshot));
      if (receipts.dropped.length > 0) {
        yield* Effect.logInfo("Dropped receipts Jev could not back up with text it read", { dropped: receipts.dropped });
      }
      const verdict = normalizeVerdict({ ...raw, receipts: receipts.kept }, input.snapshot.host || input.siteKey);
      return { verdict, model: response.model || settings.model } satisfies JudgeResult;
    },
    (effect) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: LIMITS.judgeTimeout,
          orElse: () =>
            Effect.fail(new JudgeError({ reason: "api", message: `Judging took longer than ${LIMITS.judgeTimeout}`, retryable: true })),
        }),
      ),
  );

  const duel = Effect.fn("OpenRouterJudge.duel")(
    function* (input: DuelInput) {
      yield* Effect.annotateCurrentSpan({ score: input.score, a: input.a.siteKey, b: input.b.siteKey });
      const response = yield* complete(
        {
          model: settings.model,
          max_tokens: LIMITS.duelMaxTokens,
          messages: [
            { role: "system", content: DUEL_SYSTEM_PROMPT },
            { role: "user", content: buildDuelUserMessage(input) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "duel", strict: true, schema: DUEL_JSON_SCHEMA } },
          ...reasoningFor(settings.duelEffort),
          provider: { require_parameters: true },
        },
        "duel",
      );
      const verdict = yield* decodeAnswer(response, decodeDuel, "duel verdict");
      return { winner: verdict.winner, reason: verdict.reason.trim() };
    },
    (effect) =>
      effect.pipe(
        Effect.timeoutOrElse({
          duration: LIMITS.duelTimeout,
          orElse: () =>
            Effect.fail(new JudgeError({ reason: "api", message: `The duel took longer than ${LIMITS.duelTimeout}`, retryable: true })),
        }),
      ),
  );

  return Judge.of({ kind: "live", judge, duel });
};

/** Jev configured from `AppConfig.openrouter`, HTTP client not yet provided (tests inject a fake one). */
export const layerWith = (options: Partial<Pick<OpenRouterJudgeSettings, "retrySchedule">> = {}) =>
  Layer.effect(
    Judge,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const http = yield* HttpClient.HttpClient;
      if (Option.isNone(config.openrouter)) {
        const notConfigured = new JudgeError({ reason: "config", message: "OPENROUTER_API_KEY is not configured", retryable: false });
        return Judge.of({ kind: "live", judge: () => Effect.fail(notConfigured), duel: () => Effect.fail(notConfigured) });
      }
      return makeOpenRouterJudge(http, {
        ...config.openrouter.value,
        referer: Option.getOrUndefined(config.publicUrl),
        ...options,
      });
    }),
  );

/** The real, OpenRouter-backed Jev over the platform `fetch`. */
export const OpenRouterJudgeLive: Layer.Layer<Judge, never, AppConfig> = layerWith().pipe(Layer.provide(FetchHttpClient.layer));
