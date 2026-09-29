import { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Data, Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { toCodecAnthropic } from "effect/ai/AnthropicStructuredOutput";
import { AppConfig, type AppConfigShape } from "../../config";
import { JudgeError } from "../../domain/errors";
import { DuelVerdict, Verdict } from "../../domain/models";
import { type DuelInput, Judge, type JudgeInput, type JudgeResult } from "../Judge";
import { AnthropicMessages } from "./AnthropicMessages";
import { evidenceCorpus, verifyReceipts } from "./receipts";
import {
  allowedFetchDomains,
  buildDuelUserMessage,
  buildJudgeUserMessage,
  buildResearchUserMessage,
  buildVerdictFromNotesUserMessage,
  DUEL_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  SNAPSHOT_LIMITS,
} from "./prompts";

/**
 * The real Jev: Claude reads the crawler snapshot, may crawl more of the site
 * itself with the server-side web_fetch tool (locked to the site's domain),
 * and answers with a structured verdict. Exact-score ties are settled with a
 * small, tool-less duel call.
 *
 * Request shape (judge):
 *   client.beta.messages.stream({
 *     model, max_tokens,
 *     betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
 *     system: [{ text: JUDGE_SYSTEM_PROMPT, cache_control: ephemeral }],
 *     tools: [{ type: "web_fetch_20260309", allowed_domains: [host, www.host], max_uses, max_content_tokens, use_cache? }],
 *     output_config: { effort: judgeEffort, format: { type: "json_schema", schema: Verdict } },
 *     messages: [{ role: "user", content: <case header + untrusted snapshot> }],
 *   })
 *
 * If the API ever rejects structured outputs combined with the server tool,
 * Jev switches (for the rest of the process) to two steps: research with
 * web_fetch producing notes, then a tool-less structuring call.
 */

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeJudgeSettings {
  readonly model: string;
  readonly judgeEffort: Effort;
  readonly duelEffort: Effort;
}

/** Opt into server-side refusal fallbacks (`fallbacks: "default"`). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const LIMITS = {
  /**
   * max_tokens at low/medium effort. Thinking counts toward max_tokens on
   * Opus 5.5 (it is always on), so higher efforts get a multiple of these.
   */
  judgeMaxTokens: 16_000,
  researchMaxTokens: 16_000,
  duelMaxTokens: 8_000,
  /** How many times a `pause_turn` is resumed before giving up. */
  maxContinuations: 4,
  webFetchMaxUses: 4,
  webFetchMaxContentTokens: 8_000,
  judgeTimeout: "8 minutes",
  duelTimeout: "2 minutes",
} as const;

const EFFORT_TOKEN_MULTIPLIER: Record<Effort, number> = { low: 1, medium: 1, high: 2, xhigh: 4, max: 4 };

/** Room for thinking plus the answer; only generated tokens are billed. */
export const maxTokensFor = (base: number, effort: Effort): number => base * EFFORT_TOKEN_MULTIPLIER[effort];

const verdictOutput = toCodecAnthropic(Verdict);
const duelOutput = toCodecAnthropic(DuelVerdict);

/** JSON schemas sent as `output_config.format` (constraints like 1-1000 are enforced by the codecs instead). */
export const VERDICT_JSON_SCHEMA: { readonly [key: string]: unknown } = verdictOutput.jsonSchema;
export const DUEL_JSON_SCHEMA: { readonly [key: string]: unknown } = duelOutput.jsonSchema;

const decodeVerdictJson = Schema.decodeUnknownEffect(Schema.fromJsonString(verdictOutput.codec));
const decodeDuelJson = Schema.decodeUnknownEffect(Schema.fromJsonString(duelOutput.codec));

/** Raw SDK failure, kept un-mapped until we've checked whether it calls for the two-step fallback. */
class AnthropicCallError extends Data.TaggedError("AnthropicCallError")<{ readonly cause: unknown }> {}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const RETRYABLE_ERROR_TYPES = new Set(["rate_limit_error", "overloaded_error", "api_error", "timeout_error"]);
const CONFIG_ERROR_TYPES = new Set(["authentication_error", "permission_error", "billing_error"]);

const errorTypeOf = (error: APIError): string | null => {
  if (error.type) return error.type;
  const body = error.error as { readonly error?: { readonly type?: unknown } } | undefined;
  return typeof body?.error?.type === "string" ? body.error.type : null;
};

/**
 * SDK failure -> JudgeError. Transient trouble (429, 5xx, overloaded,
 * connection, timeouts) is retryable; anything that would fail the same way
 * again is not, and auth/billing problems are reported as config errors.
 */
export const toJudgeError = (cause: unknown): JudgeError => {
  if (cause instanceof JudgeError) return cause;
  if (cause instanceof APIUserAbortError) {
    return new JudgeError({ reason: "api", message: "Anthropic request was aborted", retryable: true });
  }
  if (cause instanceof APIConnectionError) {
    return new JudgeError({ reason: "api", message: `Anthropic API unreachable: ${cause.message}`, retryable: true });
  }
  if (cause instanceof APIError) {
    const status = cause.status;
    const type = errorTypeOf(cause);
    const message = `Anthropic API error (${status ?? "mid-stream"}${type ? ` ${type}` : ""}): ${cause.message}`;
    if (status === 401 || status === 403 || (type !== null && CONFIG_ERROR_TYPES.has(type))) {
      return new JudgeError({ reason: "config", message, retryable: false });
    }
    if (status === undefined) {
      // An `error` event inside an already-open stream (e.g. overloaded_error).
      return new JudgeError({ reason: "api", message, retryable: type === null || RETRYABLE_ERROR_TYPES.has(type) });
    }
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    return new JudgeError({ reason: "api", message, retryable });
  }
  if (cause instanceof AnthropicError) {
    // SDK-level stream problems (e.g. the stream ended before a message arrived).
    return new JudgeError({ reason: "api", message: `Anthropic SDK error: ${cause.message}`, retryable: true });
  }
  return new JudgeError({ reason: "api", message: `Unexpected error calling Claude: ${String(cause)}`, retryable: false });
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
};

/**
 * True for a 400 that says structured outputs can't be combined with the
 * (server) tools in this request: the cue to switch to the two-step flow.
 */
export const isStructuredOutputToolConflict = (cause: unknown): boolean => {
  if (!(cause instanceof APIError) || cause.status !== 400) return false;
  const text = `${cause.message} ${safeJson(cause.error)}`.toLowerCase();
  const mentionsFormat = /output_config|output_format|json_schema|structured[ _-]?output|output format|response format/.test(text);
  const mentionsTools = /\btools?\b|web_fetch|server[ _-]?tool/.test(text);
  return mentionsFormat && mentionsTools;
};

// ---------------------------------------------------------------------------
// Reading responses
// ---------------------------------------------------------------------------

/** Blocks that sit "between" pieces of the final answer without ending it. */
const isTransparent = (block: BetaContentBlock): boolean =>
  block.type === "thinking" || block.type === "redacted_thinking" || block.type === "fallback";

/**
 * Candidate texts for the structured answer, most likely first: the last text
 * block; the trailing run of text blocks joined (a mid-stream refusal fallback
 * continues the declined model's partial text in a new block); and the
 * outermost {...} of that run, in case some prose slipped in around the JSON.
 */
export const answerTextCandidates = (content: ReadonlyArray<BetaContentBlock>): Array<string> => {
  let last: string | undefined;
  let trailing: Array<string> = [];
  for (const block of content) {
    if (block.type === "text") {
      last = block.text;
      trailing.push(block.text);
    } else if (!isTransparent(block)) {
      trailing = [];
    }
  }
  const joined = trailing.join("");
  const start = joined.indexOf("{");
  const end = joined.lastIndexOf("}");
  const braced = start >= 0 && end > start ? joined.slice(start, end + 1) : undefined;
  const candidates = [last, joined, braced]
    .filter((text): text is string => text !== undefined)
    .map((text) => text.trim())
    .filter((text) => text !== "");
  return [...new Set(candidates)];
};

/** URLs Jev successfully fetched with web_fetch across every response of a conversation. */
export const pagesFetchedIn = (responses: ReadonlyArray<BetaMessage>): Array<string> => {
  const blocks = responses.flatMap((response) => response.content);
  const failed = new Set<string>();
  for (const block of blocks) {
    if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_tool_result_error") {
      failed.add(block.tool_use_id);
    }
  }
  const urls: Array<string> = [];
  for (const block of blocks) {
    if (block.type !== "server_tool_use" || block.name !== "web_fetch" || failed.has(block.id)) continue;
    const url = block.input["url"];
    if (typeof url === "string" && url.trim() !== "") urls.push(url.trim());
  }
  return [...new Set(urls)];
};

const serverToolResultId = (block: BetaContentBlock): string | undefined =>
  block.type.endsWith("_tool_result") && "tool_use_id" in block && typeof block.tool_use_id === "string"
    ? block.tool_use_id
    : undefined;

/**
 * Content to echo back when resuming a `pause_turn`. Usually verbatim; after a
 * mid-output refusal fallback, the declined model's thinking, client tool
 * calls and unpaired server-tool blocks before the last `fallback` marker are
 * dropped (as the fallback docs require), and the marker itself is dropped.
 */
export const echoableContent = (content: ReadonlyArray<BetaContentBlock>): Array<BetaContentBlockParam> => {
  const boundary = content.findLastIndex((block) => block.type === "fallback");
  if (boundary < 0) return [...content];
  const useIds = new Set(content.flatMap((block) => (block.type === "server_tool_use" ? [block.id] : [])));
  const resultIds = new Set(content.flatMap((block) => serverToolResultId(block) ?? []));
  return content.filter((block, index) => {
    if (index > boundary) return true;
    if (block.type === "text") return true;
    if (block.type === "server_tool_use") return resultIds.has(block.id);
    const resultFor = serverToolResultId(block);
    if (resultFor !== undefined) return useIds.has(resultFor);
    return false;
  });
};

const textOf = (responses: ReadonlyArray<BetaMessage>): string =>
  responses
    .flatMap((response) => response.content)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();

// ---------------------------------------------------------------------------
// Tidying the verdict
// ---------------------------------------------------------------------------

const slug = (label: string): string =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
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

const cachedSystem = (text: string): Array<BetaTextBlockParam> => [
  { type: "text", text, cache_control: { type: "ephemeral" } },
];

const webFetchTool = (domains: ReadonlyArray<string>, fresh: boolean): BetaToolUnion => ({
  type: "web_fetch_20260309",
  name: "web_fetch",
  allowed_domains: [...domains],
  max_uses: LIMITS.webFetchMaxUses,
  max_content_tokens: LIMITS.webFetchMaxContentTokens,
  // Rerolls must look at the live site again, not a cached copy.
  ...(fresh ? { use_cache: false } : {}),
});

export const makeClaudeJudge = Effect.fnUntraced(function* (settings: ClaudeJudgeSettings) {
  const api = yield* AnthropicMessages;
  /** Flips to "two-step" (for the life of the process) if the API rejects format + tools together. */
  const mode = yield* Ref.make<"combined" | "two-step">("combined");

  const base = {
    model: settings.model,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  } satisfies Partial<BetaMessageStreamParams>;

  const logUsage = (label: string, response: BetaMessage) => {
    const usage = response.usage;
    const servedByFallback = usage?.iterations?.some((entry) => entry.type === "fallback_message") ?? false;
    return Effect.logDebug("Jev token usage", {
      call: label,
      model: response.model,
      stopReason: response.stop_reason,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      webFetches: usage?.server_tool_use?.web_fetch_requests ?? 0,
    }).pipe(
      Effect.andThen(
        servedByFallback && response.stop_reason !== "refusal"
          ? Effect.logInfo("Jev's request was served by a fallback model", { call: label, model: response.model })
          : Effect.void,
      ),
    );
  };

  const send = (params: BetaMessageStreamParams, label: string) =>
    Effect.tryPromise({
      try: (signal) => api.send(params, { signal }),
      catch: (cause) => new AnthropicCallError({ cause }),
    }).pipe(Effect.tap((response) => logUsage(label, response)));

  /**
   * One logical turn: sends the request and resumes `pause_turn`s (appending
   * the paused assistant content and re-sending, no extra user message).
   * Refusals end the turn with a non-retryable `refused` error.
   */
  const converse = Effect.fnUntraced(function* (params: BetaMessageStreamParams, label: string) {
    const responses: Array<BetaMessage> = [];
    let messages: Array<BetaMessageParam> = [...params.messages];
    for (let continuation = 0; ; continuation++) {
      const response = yield* send({ ...params, messages }, label);
      responses.push(response);
      if (response.stop_reason === "refusal") {
        const details = response.stop_details;
        return yield* new JudgeError({
          reason: "refused",
          message: `Claude declined (${details?.category ?? "no category"})${details?.explanation ? `: ${details.explanation}` : ""}`,
          retryable: false,
        });
      }
      if (response.stop_reason !== "pause_turn") return { final: response, responses };
      if (continuation >= LIMITS.maxContinuations) {
        return yield* new JudgeError({
          reason: "invalid-output",
          message: `Claude was still paused after ${LIMITS.maxContinuations} continuations`,
          retryable: true,
        });
      }
      messages = [...messages, { role: "assistant", content: echoableContent(response.content) }];
    }
  });

  /** Decodes the structured answer of a finished turn with the given codec. */
  const decodeAnswer = <A>(
    response: BetaMessage,
    decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
    what: string,
  ): Effect.Effect<A, JudgeError> =>
    Effect.gen(function* () {
      if (response.stop_reason === "max_tokens") {
        return yield* new JudgeError({ reason: "invalid-output", message: `The ${what} was cut off at max_tokens`, retryable: true });
      }
      if (response.stop_reason === "model_context_window_exceeded") {
        return yield* new JudgeError({ reason: "invalid-output", message: `The ${what} overflowed the context window`, retryable: false });
      }
      const candidates = answerTextCandidates(response.content);
      if (candidates.length === 0) {
        return yield* new JudgeError({ reason: "invalid-output", message: `Claude returned no ${what}`, retryable: true });
      }
      let firstError: Schema.SchemaError | undefined;
      for (const candidate of candidates) {
        const result = yield* Effect.result(decode(candidate));
        if (Result.isSuccess(result)) return result.success;
        firstError ??= result.failure;
      }
      return yield* new JudgeError({
        reason: "invalid-output",
        message: `Claude's ${what} failed validation: ${firstError?.message ?? "unknown error"}`,
        retryable: true,
      });
    });

  /** A finished judgment plus every response whose fetched pages count as evidence for receipts. */
  interface Judged {
    readonly result: JudgeResult;
    readonly responses: ReadonlyArray<BetaMessage>;
  }

  const judgeCombined = Effect.fnUntraced(function* (input: JudgeInput, domains: ReadonlyArray<string>) {
    const { final, responses } = yield* converse(
      {
        ...base,
        max_tokens: maxTokensFor(LIMITS.judgeMaxTokens, settings.judgeEffort),
        system: cachedSystem(JUDGE_SYSTEM_PROMPT),
        tools: [webFetchTool(domains, input.fresh)],
        output_config: { effort: settings.judgeEffort, format: { type: "json_schema", schema: VERDICT_JSON_SCHEMA } },
        messages: [{ role: "user", content: buildJudgeUserMessage(input, domains) }],
      },
      "judge",
    );
    const verdict = yield* decodeAnswer(final, decodeVerdictJson, "verdict");
    return {
      result: { verdict, model: final.model, pagesFetchedByJev: pagesFetchedIn(responses) },
      responses,
    } satisfies Judged;
  });

  const judgeTwoStep = Effect.fnUntraced(function* (input: JudgeInput, domains: ReadonlyArray<string>) {
    const research = yield* converse(
      {
        ...base,
        max_tokens: maxTokensFor(LIMITS.researchMaxTokens, settings.judgeEffort),
        system: cachedSystem(JUDGE_SYSTEM_PROMPT),
        tools: [webFetchTool(domains, input.fresh)],
        output_config: { effort: settings.judgeEffort },
        messages: [{ role: "user", content: buildResearchUserMessage(input, domains) }],
      },
      "judge.research",
    );
    const pagesFetchedByJev = pagesFetchedIn(research.responses);
    const notes = textOf(research.responses).slice(0, SNAPSHOT_LIMITS.notes);
    const { final } = yield* converse(
      {
        ...base,
        max_tokens: maxTokensFor(LIMITS.judgeMaxTokens, settings.judgeEffort),
        system: cachedSystem(JUDGE_SYSTEM_PROMPT),
        output_config: { effort: settings.judgeEffort, format: { type: "json_schema", schema: VERDICT_JSON_SCHEMA } },
        messages: [{ role: "user", content: buildVerdictFromNotesUserMessage(input, notes, pagesFetchedByJev) }],
      },
      "judge.verdict",
    );
    const verdict = yield* decodeAnswer(final, decodeVerdictJson, "verdict");
    return { result: { verdict, model: final.model, pagesFetchedByJev }, responses: research.responses } satisfies Judged;
  });

  const judge = Effect.fn("ClaudeJudge.judge")(
    function* (input: JudgeInput) {
      yield* Effect.annotateCurrentSpan({ siteKey: input.siteKey, roll: input.roll, fresh: input.fresh });
      const domains = allowedFetchDomains(input);
      const current = yield* Ref.get(mode);
      const { result, responses }: Judged =
        current === "two-step"
          ? yield* judgeTwoStep(input, domains)
          : yield* judgeCombined(input, domains).pipe(
              Effect.catchTag("AnthropicCallError", (error) =>
                isStructuredOutputToolConflict(error.cause)
                  ? Effect.logWarning(
                      "Claude rejected structured output + web_fetch in one request; switching Jev to two-step judging",
                      { error: String(error.cause) },
                    ).pipe(Effect.andThen(Ref.set(mode, "two-step")), Effect.andThen(judgeTwoStep(input, domains)))
                  : Effect.fail(error),
              ),
            );
      const receipts = verifyReceipts(result.verdict.receipts, evidenceCorpus(input.snapshot, responses));
      if (receipts.dropped.length > 0) {
        yield* Effect.logInfo("Dropped receipts Jev could not back up with text it read", { dropped: receipts.dropped });
      }
      const verdict = normalizeVerdict({ ...result.verdict, receipts: receipts.kept }, input.snapshot.host || input.siteKey);
      return { ...result, verdict } satisfies JudgeResult;
    },
    (effect) =>
      effect.pipe(
        Effect.mapError((error) => (error._tag === "AnthropicCallError" ? toJudgeError(error.cause) : error)),
        Effect.timeoutOrElse({
          duration: LIMITS.judgeTimeout,
          orElse: () =>
            Effect.fail(new JudgeError({ reason: "api", message: `Judging took longer than ${LIMITS.judgeTimeout}`, retryable: true })),
        }),
      ),
  );

  const duel = Effect.fn("ClaudeJudge.duel")(
    function* (input: DuelInput) {
      yield* Effect.annotateCurrentSpan({ score: input.score, a: input.a.siteKey, b: input.b.siteKey });
      const { final } = yield* converse(
        {
          ...base,
          max_tokens: maxTokensFor(LIMITS.duelMaxTokens, settings.duelEffort),
          system: cachedSystem(DUEL_SYSTEM_PROMPT),
          output_config: { effort: settings.duelEffort, format: { type: "json_schema", schema: DUEL_JSON_SCHEMA } },
          messages: [{ role: "user", content: buildDuelUserMessage(input) }],
        },
        "duel",
      );
      const verdict = yield* decodeAnswer(final, decodeDuelJson, "duel verdict");
      return { winner: verdict.winner, reason: verdict.reason.trim() };
    },
    (effect) =>
      effect.pipe(
        Effect.mapError((error) => (error._tag === "AnthropicCallError" ? toJudgeError(error.cause) : error)),
        Effect.timeoutOrElse({
          duration: LIMITS.duelTimeout,
          orElse: () =>
            Effect.fail(new JudgeError({ reason: "api", message: `The duel took longer than ${LIMITS.duelTimeout}`, retryable: true })),
        }),
      ),
  );

  return Judge.of({ kind: "claude", judge, duel });
});

const notConfigured = new JudgeError({
  reason: "config",
  message: "ANTHROPIC_API_KEY is not configured",
  retryable: false,
});

/** Jev with an injectable `AnthropicMessages` (tests provide canned responses). */
export const ClaudeJudgeNoDeps: Layer.Layer<Judge, never, AppConfig | AnthropicMessages> = Layer.effect(
  Judge,
  Effect.gen(function* () {
    const config: AppConfigShape = yield* AppConfig;
    if (Option.isNone(config.anthropic)) {
      return Judge.of({ kind: "claude", judge: () => Effect.fail(notConfigured), duel: () => Effect.fail(notConfigured) });
    }
    const { model, judgeEffort, duelEffort } = config.anthropic.value;
    return yield* makeClaudeJudge({ model, judgeEffort, duelEffort });
  }),
);

/** The real Claude-backed Jev. */
export const ClaudeJudgeLive: Layer.Layer<Judge, never, AppConfig> = ClaudeJudgeNoDeps.pipe(
  Layer.provide(AnthropicMessages.layer),
);
