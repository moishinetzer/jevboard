import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";
import { AppConfig } from "~/.server/config";
import { JudgeError } from "~/.server/domain/errors";
import type { SiteSnapshot } from "~/.server/domain/models";
import { Judge, type DuelInput, type JudgeInput } from "~/.server/services/Judge";
import { AnthropicMessages } from "~/.server/services/judge/AnthropicMessages";
import {
  answerTextCandidates,
  ClaudeJudgeNoDeps,
  DUEL_JSON_SCHEMA,
  echoableContent,
  FALLBACK_BETA,
  isStructuredOutputToolConflict,
  LIMITS,
  maxTokensFor,
  pagesFetchedIn,
  toJudgeError,
  VERDICT_JSON_SCHEMA,
} from "~/.server/services/judge/ClaudeJudge";
import { DUEL_SYSTEM_PROMPT, JUDGE_SYSTEM_PROMPT } from "~/.server/services/judge/prompts";
import { evidenceCorpus, verifyReceipts } from "~/.server/services/judge/receipts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const snapshot: SiteSnapshot = {
  requestedUrl: "https://acme.com",
  finalUrl: "https://acme.com/",
  host: "acme.com",
  title: "Acme Invoicing | Invoices for plumbers",
  description: "Send invoices from the van.",
  ogImage: null,
  favicon: null,
  pages: [
    {
      url: "https://acme.com/",
      title: "Acme Invoicing",
      description: "Send invoices from the van.",
      headings: ["Invoices in 30 seconds", "Trusted by 2,000 plumbers"],
      text: "Acme lets plumbers send invoices from their phone. Plans from $12/month.",
    },
  ],
  fetchedAt: Date.UTC(2026, 8, 29),
};

const judgeInput: JudgeInput = {
  siteKey: "acme.com",
  url: "https://acme.com",
  snapshot,
  roll: 1,
  fresh: false,
};

const goodVerdict = {
  name: "Acme Invoicing",
  tldr: "Invoicing app for plumbers and other trades.",
  category: "SaaS",
  score: 637,
  label: "Boring In The Way Accountants Love!",
  verdict: "Invoicing for plumbers, priced on the page. Jev is almost disappointed.",
  reasoning: "Clear product, clear customer, visible pricing. Solid band.",
  subscores: { clarity: 82, demand: 71, originality: 38, trust: 64, wouldJevPay: 55 },
  strengths: ["Clear pricing", "Clear customer", "Clear pricing", "Mobile-first", "Extra"],
  weaknesses: ["Crowded category"],
  receipts: ["Invoices in 30 seconds"],
  manipulationAttempt: false,
  contentFlag: "none",
} as const;

const text = (value: string): BetaContentBlock => ({ type: "text", text: value, citations: null });
const thinking = (): BetaContentBlock => ({ type: "thinking", thinking: "", signature: "sig" });
const fetchUse = (id: string, url: string): BetaContentBlock => ({
  type: "server_tool_use",
  id,
  name: "web_fetch",
  input: { url },
});
const fetchResult = (id: string, url: string): BetaContentBlock => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: {
    type: "web_fetch_result",
    url,
    retrieved_at: null,
    content: {
      type: "document",
      title: null,
      citations: null,
      source: { type: "text", media_type: "text/plain", data: "Pricing: $12/month" },
    },
  },
});
const fetchFailed = (id: string): BetaContentBlock => ({
  type: "web_fetch_tool_result",
  tool_use_id: id,
  content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" },
});
const fallbackMarker = (): BetaContentBlock => ({
  type: "fallback",
  from: { model: "claude-opus-5-5" },
  to: { model: "claude-opus-5" },
  trigger: { type: "refusal", category: "cyber" },
});

const message = (content: Array<BetaContentBlock>, overrides: Partial<BetaMessage> = {}): BetaMessage => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  container: null,
  context_management: null,
  diagnostics: null,
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 1_234,
    output_tokens: 567,
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: null,
    inference_geo: null,
    iterations: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
  },
  ...overrides,
});

const verdictMessage = (verdict: object = goodVerdict, overrides: Partial<BetaMessage> = {}) =>
  message([thinking(), text(JSON.stringify(verdict))], overrides);

const apiBody = (type: string, msg: string) => ({ type: "error", error: { type, message: msg } });

// ---------------------------------------------------------------------------
// Fake Messages API
// ---------------------------------------------------------------------------

type Step = BetaMessage | Error | ((params: BetaMessageStreamParams, signal: AbortSignal) => Promise<BetaMessage>);

const fakeApi = (
  script: ReadonlyArray<Step>,
  efforts: { readonly judgeEffort: "low" | "medium" | "high" | "xhigh" | "max"; readonly duelEffort: "low" | "medium" | "high" | "xhigh" | "max" } = {
    judgeEffort: "medium",
    duelEffort: "low",
  },
) => {
  const calls: Array<{ readonly params: BetaMessageStreamParams; readonly signal: AbortSignal }> = [];
  const send: AnthropicMessages["Service"]["send"] = async (params, { signal }) => {
    calls.push({ params, signal });
    const step = script[calls.length - 1];
    if (step === undefined) throw new Error(`unexpected call #${calls.length}`);
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(params, signal) : step;
  };
  const layer = ClaudeJudgeNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        AppConfig.layerTest({
          anthropic: Option.some({
            apiKey: Redacted.make("sk-test"),
            model: "claude-opus-5-5",
            ...efforts,
          }),
        }),
        AnthropicMessages.layerTest(send),
      ),
    ),
  );
  return { calls, layer };
};

const userText = (params: BetaMessageStreamParams): string => {
  const first = params.messages[0];
  assert(first !== undefined && typeof first.content === "string");
  return first.content;
};

const judgeFails = (script: ReadonlyArray<Step>, input: JudgeInput = judgeInput) => {
  const api = fakeApi(script);
  return Judge.use((judge) => judge.judge(input)).pipe(Effect.flip, Effect.provide(api.layer));
};

// ---------------------------------------------------------------------------
// judge
// ---------------------------------------------------------------------------

describe("ClaudeJudge.judge", () => {
  it.effect("decodes a verdict and sends the documented request shape", () =>
    Effect.gen(function* () {
      const api = fakeApi([verdictMessage(goodVerdict, { model: "claude-opus-5" })]);
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer));

      expect(result.model).toBe("claude-opus-5"); // whoever actually served it (e.g. a fallback model)
      expect(result.pagesFetchedByJev).toEqual([]);
      expect(result.verdict.score).toBe(637);
      expect(result.verdict.category).toBe("SaaS");
      expect(result.verdict.label).toBe("boring-in-the-way-accountants-love");
      expect(result.verdict.strengths).toEqual(["Clear pricing", "Clear customer", "Mobile-first"]);

      expect(api.calls).toHaveLength(1);
      const params = api.calls[0]!.params;
      expect(params.model).toBe("claude-opus-5-5");
      expect(params.betas).toEqual([FALLBACK_BETA]);
      expect(params.fallbacks).toBe("default");
      expect(params.thinking).toBeUndefined();
      expect(params.tool_choice).toBeUndefined();
      expect(params.max_tokens).toBe(LIMITS.judgeMaxTokens);
      expect(params.system).toEqual([{ type: "text", text: JUDGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
      expect(params.output_config).toEqual({
        effort: "medium",
        format: { type: "json_schema", schema: VERDICT_JSON_SCHEMA },
      });
      expect(params.tools).toEqual([
        {
          type: "web_fetch_20260309",
          name: "web_fetch",
          allowed_domains: ["acme.com", "www.acme.com"],
          max_uses: LIMITS.webFetchMaxUses,
          max_content_tokens: LIMITS.webFetchMaxContentTokens,
        },
      ]);
      expect(params.messages).toHaveLength(1);
      expect(userText(params)).toContain("<untrusted_website_content");
    }),
  );

  it.effect("keeps receipts Jev can back up (snapshot or fetched pages) and drops invented ones", () =>
    Effect.gen(function* () {
      const api = fakeApi([
        message([
          fetchUse("srv_1", "https://acme.com/pricing"),
          fetchResult("srv_1", "https://acme.com/pricing"),
          text(
            JSON.stringify({
              ...goodVerdict,
              receipts: ["\u201cINVOICES in 30 seconds.\u201d", "Pricing: $12/month", "We are the Uber of invoices"],
            }),
          ),
        ]),
      ]);
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer));
      expect(result.verdict.receipts).toEqual(["\u201cINVOICES in 30 seconds.\u201d", "Pricing: $12/month"]);
    }),
  );

  it.effect("scales max_tokens with the configured effort", () =>
    Effect.gen(function* () {
      const api = fakeApi([verdictMessage()], { judgeEffort: "xhigh", duelEffort: "high" });
      yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer));
      expect(api.calls[0]!.params.max_tokens).toBe(LIMITS.judgeMaxTokens * 4);
      expect(api.calls[0]!.params.output_config?.effort).toBe("xhigh");
      expect(maxTokensFor(LIMITS.duelMaxTokens, "high")).toBe(LIMITS.duelMaxTokens * 2);
      expect(maxTokensFor(LIMITS.duelMaxTokens, "low")).toBe(LIMITS.duelMaxTokens);
    }),
  );

  it.effect("rerolls bypass the web_fetch cache", () =>
    Effect.gen(function* () {
      const api = fakeApi([verdictMessage()]);
      yield* Judge.use((judge) => judge.judge({ ...judgeInput, roll: 3, fresh: true })).pipe(Effect.provide(api.layer));
      const tool = api.calls[0]!.params.tools?.[0];
      expect(tool).toMatchObject({ type: "web_fetch_20260309", use_cache: false });
    }),
  );

  it.effect("an out-of-range score is invalid output (retryable)", () =>
    Effect.gen(function* () {
      const error = yield* judgeFails([verdictMessage({ ...goodVerdict, score: 1234 })]);
      expect(error).toBeInstanceOf(JudgeError);
      expect(error.reason).toBe("invalid-output");
      expect(error.retryable).toBe(true);
      expect(error.message).toMatch(/between 1 and 1000|1000/);
    }),
  );

  it.effect("an unknown category or missing field is invalid output", () =>
    Effect.gen(function* () {
      const { contentFlag: _omit, ...missing } = goodVerdict;
      expect((yield* judgeFails([verdictMessage(missing)])).reason).toBe("invalid-output");
      expect((yield* judgeFails([verdictMessage({ ...goodVerdict, category: "Vibes" })])).reason).toBe("invalid-output");
      expect((yield* judgeFails([message([text("not json at all")])])).reason).toBe("invalid-output");
      expect((yield* judgeFails([message([thinking()])])).reason).toBe("invalid-output");
    }),
  );

  it.effect("a truncated verdict (max_tokens) is retryable invalid output", () =>
    Effect.gen(function* () {
      const error = yield* judgeFails([message([text('{"name":"Acme","tl')], { stop_reason: "max_tokens" })]);
      expect(error.reason).toBe("invalid-output");
      expect(error.retryable).toBe(true);
    }),
  );

  it.effect("a refusal is reported as refused and not retried", () =>
    Effect.gen(function* () {
      const api = fakeApi([
        message([], {
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: "declined" } as BetaMessage["stop_details"],
        }),
      ]);
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.flip, Effect.provide(api.layer));
      expect(error.reason).toBe("refused");
      expect(error.retryable).toBe(false);
      expect(error.message).toContain("cyber");
      expect(api.calls).toHaveLength(1);
    }),
  );

  it.effect("resumes pause_turn by echoing the paused content and collects every fetched page", () =>
    Effect.gen(function* () {
      const paused = message(
        [thinking(), fetchUse("srv_1", "https://acme.com/pricing"), fetchResult("srv_1", "https://acme.com/pricing")],
        { stop_reason: "pause_turn" },
      );
      const done = message([
        fetchUse("srv_2", "https://acme.com/customers"),
        fetchResult("srv_2", "https://acme.com/customers"),
        thinking(),
        text(JSON.stringify(goodVerdict)),
      ]);
      const api = fakeApi([paused, done]);
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer));

      expect(result.pagesFetchedByJev).toEqual(["https://acme.com/pricing", "https://acme.com/customers"]);
      expect(api.calls).toHaveLength(2);
      const resumed = api.calls[1]!.params;
      expect(resumed.messages).toHaveLength(2);
      expect(resumed.messages[0]).toEqual(api.calls[0]!.params.messages[0]);
      expect(resumed.messages[1]).toEqual({ role: "assistant", content: paused.content });
      // Same request otherwise (tools, schema, system) so the server can resume.
      expect(resumed.tools).toEqual(api.calls[0]!.params.tools);
      expect(resumed.output_config).toEqual(api.calls[0]!.params.output_config);
    }),
  );

  it.effect("gives up after too many pause_turn continuations", () =>
    Effect.gen(function* () {
      const paused = message([fetchUse("srv_1", "https://acme.com/a"), fetchResult("srv_1", "https://acme.com/a")], {
        stop_reason: "pause_turn",
      });
      const error = yield* judgeFails(Array.from({ length: LIMITS.maxContinuations + 1 }, () => paused));
      expect(error.reason).toBe("invalid-output");
      expect(error.retryable).toBe(true);
    }),
  );

  it.effect("decodes a verdict split by a mid-stream refusal fallback", () =>
    Effect.gen(function* () {
      const json = JSON.stringify(goodVerdict);
      const cut = json.indexOf('"verdict"');
      const api = fakeApi([
        message([text(json.slice(0, cut)), fallbackMarker(), thinking(), text(json.slice(cut))], { model: "claude-opus-5" }),
      ]);
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer));
      expect(result.verdict.score).toBe(637);
      expect(result.model).toBe("claude-opus-5");
    }),
  );

  it.live("interrupting the judgment aborts the HTTP request", () =>
    Effect.gen(function* () {
      const api = fakeApi([(_params, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))]);
      const fiber = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(api.layer), Effect.forkChild);
      while (api.calls.length === 0) yield* Effect.sleep("1 millis");
      expect(api.calls[0]!.signal.aborted).toBe(false);
      yield* Fiber.interrupt(fiber);
      expect(api.calls[0]!.signal.aborted).toBe(true);
    }),
  );

  it.effect("fails with a config error when no API key is configured", () =>
    Effect.gen(function* () {
      const layer = ClaudeJudgeNoDeps.pipe(
        Layer.provide(
          Layer.mergeAll(
            AppConfig.layerTest(),
            AnthropicMessages.layerTest(() => Promise.reject(new Error("must not be called"))),
          ),
        ),
      );
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.flip, Effect.provide(layer));
      expect(error.reason).toBe("config");
      expect(error.retryable).toBe(false);
    }),
  );
});

// ---------------------------------------------------------------------------
// Two-step fallback
// ---------------------------------------------------------------------------

describe("ClaudeJudge two-step fallback", () => {
  const conflict = () =>
    new BadRequestError(
      400,
      apiBody("invalid_request_error", "output_config.format: structured outputs are not supported with server tools (web_fetch)"),
      undefined,
      new Headers(),
    );

  it.effect("splits into research + structuring when the API rejects format + tools, and stays split", () =>
    Effect.gen(function* () {
      const notes = "1. Invoicing for plumbers.\n4. \"Invoices in 30 seconds\"\n5. Band 500-699, about 637.";
      const research = message([
        fetchUse("srv_1", "https://acme.com/pricing"),
        fetchResult("srv_1", "https://acme.com/pricing"),
        thinking(),
        text(notes),
      ]);
      const api = fakeApi([
        conflict(),
        research,
        verdictMessage(),
        // second judgment on the same layer: straight to two-step
        message([text("second notes")]),
        verdictMessage({ ...goodVerdict, score: 641 }),
      ]);

      const [first, second] = yield* Judge.use((judge) =>
        Effect.all([judge.judge(judgeInput), judge.judge({ ...judgeInput, roll: 2, fresh: true })]),
      ).pipe(Effect.provide(api.layer));

      expect(first.verdict.score).toBe(637);
      expect(first.pagesFetchedByJev).toEqual(["https://acme.com/pricing"]);
      expect(second.verdict.score).toBe(641);
      expect(api.calls).toHaveLength(5);

      const [combined, step1, step2, again1, again2] = api.calls.map((call) => call.params);
      // attempt 1: combined
      expect(combined!.tools).toHaveLength(1);
      expect(combined!.output_config?.format).toBeDefined();
      // step 1: research with web_fetch, no structured output
      expect(step1!.tools?.[0]).toMatchObject({ type: "web_fetch_20260309", allowed_domains: ["acme.com", "www.acme.com"] });
      expect(step1!.output_config).toEqual({ effort: "medium" });
      expect(userText(step1!)).toContain("Phase 1 of 2");
      // step 2: structured output, no tools, carries the notes and fetched pages
      expect(step2!.tools).toBeUndefined();
      expect(step2!.output_config?.format).toEqual({ type: "json_schema", schema: VERDICT_JSON_SCHEMA });
      expect(userText(step2!)).toContain(notes);
      expect(userText(step2!)).toContain("https://acme.com/pricing");
      // later judgments skip the doomed combined attempt
      expect(again1!.output_config?.format).toBeUndefined();
      expect(again1!.tools?.[0]).toMatchObject({ use_cache: false });
      expect(again2!.tools).toBeUndefined();
    }),
  );

  it.effect("an unrelated 400 does not trigger the fallback", () =>
    Effect.gen(function* () {
      const error = yield* judgeFails([
        new BadRequestError(400, apiBody("invalid_request_error", "max_tokens: must be positive"), undefined, new Headers()),
      ]);
      expect(error.reason).toBe("api");
      expect(error.retryable).toBe(false);
    }),
  );

  it("recognises format/tool conflicts only on 400s that mention both", () => {
    expect(isStructuredOutputToolConflict(conflict())).toBe(true);
    expect(
      isStructuredOutputToolConflict(
        new BadRequestError(400, apiBody("invalid_request_error", "tools: unknown tool type"), undefined, new Headers()),
      ),
    ).toBe(false);
    expect(
      isStructuredOutputToolConflict(
        new InternalServerError(500, apiBody("api_error", "output_config with tools exploded"), undefined, new Headers()),
      ),
    ).toBe(false);
    expect(isStructuredOutputToolConflict(new Error("output_config tools"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("toJudgeError", () => {
  const headers = new Headers();
  const cases: Array<[string, unknown, JudgeError["reason"], boolean]> = [
    ["429 rate limit", new RateLimitError(429, apiBody("rate_limit_error", "slow down"), undefined, headers), "api", true],
    ["500", new InternalServerError(500, apiBody("api_error", "boom"), undefined, headers), "api", true],
    ["529 overloaded", new InternalServerError(529, apiBody("overloaded_error", "Overloaded"), undefined, headers), "api", true],
    ["connection", new APIConnectionError({ message: "ECONNRESET" }), "api", true],
    ["timeout", new APIConnectionTimeoutError(), "api", true],
    [
      "mid-stream overloaded",
      new APIError(undefined, apiBody("overloaded_error", "Overloaded"), undefined, undefined, "overloaded_error"),
      "api",
      true,
    ],
    [
      "mid-stream invalid request",
      new APIError(undefined, apiBody("invalid_request_error", "nope"), undefined, undefined),
      "api",
      false,
    ],
    ["400", new BadRequestError(400, apiBody("invalid_request_error", "bad"), undefined, headers), "api", false],
    ["401", new AuthenticationError(401, apiBody("authentication_error", "bad key"), undefined, headers), "config", false],
    ["403", new PermissionDeniedError(403, apiBody("permission_error", "no"), undefined, headers), "config", false],
    ["404", new NotFoundError(404, apiBody("not_found_error", "model: claude-nope"), undefined, headers), "api", false],
    ["unknown", new TypeError("x is not a function"), "api", false],
  ];

  it.each(cases)("%s", (_name, cause, reason, retryable) => {
    const error = toJudgeError(cause);
    expect(error).toBeInstanceOf(JudgeError);
    expect(error.reason).toBe(reason);
    expect(error.retryable).toBe(retryable);
  });

  it.effect("SDK errors thrown by the API surface through judge()", () =>
    Effect.gen(function* () {
      const limited = yield* judgeFails([new RateLimitError(429, apiBody("rate_limit_error", "slow down"), undefined, headers)]);
      expect([limited.reason, limited.retryable]).toEqual(["api", true]);
      const denied = yield* judgeFails([new AuthenticationError(401, apiBody("authentication_error", "bad key"), undefined, headers)]);
      expect([denied.reason, denied.retryable]).toEqual(["config", false]);
    }),
  );
});

// ---------------------------------------------------------------------------
// duel
// ---------------------------------------------------------------------------

describe("ClaudeJudge.duel", () => {
  const duelInput: DuelInput = {
    score: 637,
    a: {
      siteKey: "acme.com",
      name: "Acme Invoicing",
      label: "boring-in-the-way-accountants-love",
      tldr: "Invoicing for plumbers.",
      category: "SaaS",
      reasoning: "Clear product.",
      strengths: ["Clear pricing"],
      weaknesses: ["Crowded category"],
    },
    b: {
      siteKey: "pipes.dev",
      name: "Pipes",
      label: "another-ai-wrapper-with-a-waitlist-and-a-gradient",
      tldr: "AI plumbing advice.",
      category: "AI",
      reasoning: "Vague.",
      strengths: [],
      weaknesses: ["Waitlist only"],
    },
  };

  it.effect("decodes the winner with a small, tool-less request", () =>
    Effect.gen(function* () {
      const api = fakeApi([message([thinking(), text(JSON.stringify({ winner: "B", reason: " Pipes helps more people. " }))])]);
      const verdict = yield* Judge.use((judge) => judge.duel(duelInput)).pipe(Effect.provide(api.layer));
      expect(verdict).toEqual({ winner: "B", reason: "Pipes helps more people." });

      const params = api.calls[0]!.params;
      expect(params.tools).toBeUndefined();
      expect(params.max_tokens).toBe(LIMITS.duelMaxTokens);
      expect(params.system).toEqual([{ type: "text", text: DUEL_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
      expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: DUEL_JSON_SCHEMA } });
      expect(params.betas).toEqual([FALLBACK_BETA]);
      expect(params.fallbacks).toBe("default");
      const user = userText(params);
      expect(user).toContain("637/1000");
      expect(user).toContain('<contender id="A">');
      expect(user).toContain("Acme Invoicing");
      expect(user).toContain('<contender id="B">');
      expect(user).toContain("pipes.dev");
    }),
  );

  it.effect("rejects a draw", () =>
    Effect.gen(function* () {
      const api = fakeApi([message([text(JSON.stringify({ winner: "draw", reason: "Both fine." }))])]);
      const error = yield* Judge.use((judge) => judge.duel(duelInput)).pipe(Effect.flip, Effect.provide(api.layer));
      expect(error.reason).toBe("invalid-output");
    }),
  );
});

// ---------------------------------------------------------------------------
// Response helpers and schemas
// ---------------------------------------------------------------------------

describe("response helpers", () => {
  it("pagesFetchedIn skips failed fetches and duplicates", () => {
    const pages = pagesFetchedIn([
      message([
        fetchUse("a", "https://acme.com/pricing"),
        fetchResult("a", "https://acme.com/pricing"),
        fetchUse("b", "https://acme.com/404"),
        fetchFailed("b"),
        fetchUse("c", "https://acme.com/pricing"),
        fetchResult("c", "https://acme.com/pricing"),
        { type: "server_tool_use", id: "d", name: "web_search", input: { query: "acme" } },
      ]),
      message([fetchUse("e", "https://acme.com/about"), fetchResult("e", "https://acme.com/about")]),
    ]);
    expect(pages).toEqual(["https://acme.com/pricing", "https://acme.com/about"]);
  });

  it("verifyReceipts tolerates typography but not new words", () => {
    const corpus = evidenceCorpus(snapshot, [
      message([fetchUse("a", "https://acme.com/pricing"), fetchResult("a", "https://acme.com/pricing")]),
    ]);
    const { kept, dropped } = verifyReceipts(
      [
        "Invoices in 30 seconds",
        "\u2018trusted by 2,000 PLUMBERS\u2019",
        "Acme lets plumbers \u2026 from their phone.",
        "Pricing: $12/month",
        "Trusted by 20,000 plumbers",
        "...",
      ],
      corpus,
    );
    expect(kept).toEqual([
      "Invoices in 30 seconds",
      "\u2018trusted by 2,000 PLUMBERS\u2019",
      "Acme lets plumbers \u2026 from their phone.",
      "Pricing: $12/month",
    ]);
    expect(dropped).toEqual(["Trusted by 20,000 plumbers", "..."]);
  });

  it("answerTextCandidates prefers the last text block, then the joined trailing run", () => {
    expect(answerTextCandidates([text("notes"), fetchUse("a", "u"), fetchResult("a", "u"), text('{"a":1}')])).toEqual([
      '{"a":1}',
    ]);
    expect(answerTextCandidates([text('{"a":'), fallbackMarker(), text("1}")])).toEqual(["1}", '{"a":1}']);
    expect(answerTextCandidates([text('Verdict: {"a":1} done')])).toEqual(['Verdict: {"a":1} done', '{"a":1}']);
    expect(answerTextCandidates([thinking()])).toEqual([]);
  });

  it("echoableContent passes content through unless a fallback happened mid-output", () => {
    const plain = [thinking(), fetchUse("a", "u"), fetchResult("a", "u")];
    expect(echoableContent(plain)).toEqual(plain);

    const declined = [
      thinking(),
      fetchUse("a", "u"),
      fetchResult("a", "u"),
      fetchUse("b", "v"), // unpaired: the declined model never got its result
      text("partial"),
      fallbackMarker(),
      thinking(),
      fetchUse("c", "w"),
      fetchResult("c", "w"),
    ];
    expect(echoableContent(declined)).toEqual([
      fetchUse("a", "u"),
      fetchResult("a", "u"),
      text("partial"),
      thinking(),
      fetchUse("c", "w"),
      fetchResult("c", "w"),
    ]);
  });

  it("the Verdict JSON schema is Anthropic-compatible: closed objects, every key required", () => {
    const schema = VERDICT_JSON_SCHEMA as {
      type: string;
      additionalProperties: boolean;
      required: Array<string>;
      properties: Record<string, { type?: string; enum?: Array<string>; additionalProperties?: boolean; required?: Array<string>; minimum?: number }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(
      [
        "name",
        "tldr",
        "category",
        "score",
        "label",
        "verdict",
        "reasoning",
        "subscores",
        "strengths",
        "weaknesses",
        "receipts",
        "manipulationAttempt",
        "contentFlag",
      ].sort(),
    );
    expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort());
    expect(schema.properties["subscores"]).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["clarity", "demand", "originality", "trust", "wouldJevPay"],
    });
    expect(schema.properties["score"]).toMatchObject({ type: "integer" });
    // Unsupported numeric constraints are stripped (the codec enforces them instead).
    expect(JSON.stringify(schema)).not.toMatch(/"(minimum|maximum|maxLength|minLength)"/);
    expect(schema.properties["category"]?.enum).toContain("Developer Tools");
    expect(schema.properties["contentFlag"]?.enum).toEqual(["none", "adult", "illegal", "scam", "hateful", "parked"]);

    expect(DUEL_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["winner", "reason"],
      properties: { winner: { type: "string", enum: ["A", "B"] } },
    });
  });
});
