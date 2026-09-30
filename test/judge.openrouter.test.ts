import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted, Schedule } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { AppConfig, type Effort } from "~/.server/config";
import type { SiteSnapshot } from "~/.server/domain/models";
import { type DuelInput, Judge, type JudgeInput } from "~/.server/services/Judge";
import {
  answerCandidates,
  layerWith,
  OPENROUTER_CHAT_URL,
  VERDICT_JSON_SCHEMA,
} from "~/.server/services/judge/OpenRouterJudge";
import { DUEL_SYSTEM_PROMPT, JUDGE_SYSTEM_PROMPT } from "~/.server/services/judge/prompts";

// ---------------------------------------------------------------------------
// A fake OpenRouter behind a fake HttpClient: records every request and
// answers from a per-test script.
// ---------------------------------------------------------------------------

interface Call {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: { readonly [key: string]: any };
}

type Reply = { readonly status: number; readonly body?: unknown } | "network-error";

const fakeOpenRouter = (respond: (call: Call, index: number) => Reply) => {
  const calls: Array<Call> = [];
  const client = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      const call: Call = { url: url.toString(), headers: { ...request.headers }, body: raw ? JSON.parse(raw) : {} };
      const reply = respond(call, calls.length);
      calls.push(call);
      if (reply === "network-error") {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "connection reset" }),
          }),
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
            status: reply.status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    }),
  );
  return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const KEY = "sk-or-v1-test0000000000000000000000000000";

const jevLayer = (
  http: Layer.Layer<HttpClient.HttpClient>,
  effort: { readonly judgeEffort?: Effort; readonly duelEffort?: Effort } = {},
) =>
  layerWith({ retrySchedule: Schedule.recurs(2) }).pipe(
    Layer.provide(http),
    Layer.provide(
      AppConfig.layerTest({
        publicUrl: Option.some("https://jevboard.test"),
        openrouter: Option.some({
          apiKey: Redacted.make(KEY),
          model: "acme/cheap-model",
          judgeEffort: effort.judgeEffort ?? "low",
          duelEffort: effort.duelEffort ?? "low",
        }),
      }),
    ),
  );

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const snapshot: SiteSnapshot = {
  requestedUrl: "https://acme.com",
  finalUrl: "https://acme.com/",
  host: "acme.com",
  title: "Acme Invoicing",
  description: "Invoices for plumbers.",
  ogImage: null,
  favicon: null,
  pages: [
    {
      url: "https://acme.com/",
      title: "Acme Invoicing",
      description: "Invoices for plumbers.",
      headings: ["Invoices in 30 seconds"],
      text: "Acme lets plumbers send invoices from their phone. Plans from $12/month.",
    },
  ],
  fetchedAt: Date.UTC(2026, 8, 30),
};

const judgeInput: JudgeInput = { siteKey: "acme.com", url: "https://acme.com", snapshot, roll: 1 };

const verdictJson = {
  name: " Acme Invoicing ",
  tldr: "Invoicing app for plumbers.",
  category: "SaaS",
  score: 612,
  label: "Boring In The Way Accountants Love!",
  verdict: "Invoices for plumbers, priced on the page. Jev is almost disappointed.",
  reasoning: "Clear product, clear customer, visible pricing.",
  subscores: { clarity: 80, demand: 70, originality: 40, trust: 60, wouldJevPay: 55 },
  strengths: ["Clear pricing", " Clear pricing ", "Mobile first", "Fast", "Cheap"],
  weaknesses: [],
  receipts: ["“Plans from $12/month.”", "Trusted by 10,000 plumbers"],
  manipulationAttempt: false,
  contentFlag: "none",
};

const completion = (content: string | null, extra: { readonly finish_reason?: string; readonly refusal?: string } = {}) => ({
  status: 200,
  body: {
    id: "gen-1",
    model: "acme/cheap-model-20260901",
    choices: [
      {
        finish_reason: extra.finish_reason ?? "stop",
        message: { role: "assistant", content, refusal: extra.refusal ?? null },
      },
    ],
    usage: { prompt_tokens: 5_000, completion_tokens: 700, total_tokens: 5_700, cost: 0.0012 },
  },
});

const ok = completion(JSON.stringify(verdictJson));

const duelInput: DuelInput = {
  score: 512,
  a: { siteKey: "a.com", name: "Alpha", label: "a", tldr: "A.", category: "SaaS", reasoning: "A.", strengths: [], weaknesses: [] },
  b: { siteKey: "b.com", name: "Beta", label: "b", tldr: "B.", category: "AI", reasoning: "B.", strengths: [], weaknesses: [] },
};

// ---------------------------------------------------------------------------

describe("OpenRouterJudge request", () => {
  it.effect("sends one structured-output chat completion with the snapshot", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => ok);
      yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)));

      assert.strictEqual(api.calls.length, 1);
      const [call] = api.calls;
      assert.strictEqual(call!.url, OPENROUTER_CHAT_URL);
      assert.strictEqual(call!.headers["authorization"], `Bearer ${KEY}`);
      assert.strictEqual(call!.headers["x-title"], "Jevboard");
      assert.strictEqual(call!.headers["http-referer"], "https://jevboard.test");

      const body = call!.body;
      assert.strictEqual(body["model"], "acme/cheap-model");
      assert.deepStrictEqual(body["reasoning"], { effort: "low", exclude: true });
      assert.deepStrictEqual(body["provider"], { require_parameters: true });
      assert.deepStrictEqual(body["response_format"], {
        type: "json_schema",
        json_schema: { name: "verdict", strict: true, schema: VERDICT_JSON_SCHEMA },
      });
      assert.strictEqual(body["messages"][0].role, "system");
      assert.strictEqual(body["messages"][0].content, JUDGE_SYSTEM_PROMPT);
      assert.strictEqual(body["messages"][1].role, "user");
      expect(body["messages"][1].content).toContain("Acme lets plumbers send invoices from their phone.");
      expect(body["messages"][1].content).toContain("<untrusted_website_content");
      assert.isUndefined(body["tools"]);
    }),
  );

  it.effect("leaves reasoning out when the effort is none", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => ok);
      yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer, { judgeEffort: "none" })));
      assert.isFalse("reasoning" in api.calls[0]!.body);
    }),
  );

  it("sends a strict schema: closed objects with every property required", () => {
    const schema = VERDICT_JSON_SCHEMA as { type: string; additionalProperties: boolean; required: Array<string>; properties: object };
    assert.strictEqual(schema.type, "object");
    assert.strictEqual(schema.additionalProperties, false);
    assert.sameMembers(schema.required, Object.keys(schema.properties));
  });
});

describe("OpenRouterJudge verdicts", () => {
  it.effect("decodes, tidies and keeps only receipts backed by the snapshot", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => ok);
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)));
      assert.strictEqual(result.model, "acme/cheap-model-20260901");
      assert.strictEqual(result.verdict.score, 612);
      assert.strictEqual(result.verdict.name, "Acme Invoicing");
      assert.strictEqual(result.verdict.label, "boring-in-the-way-accountants-love");
      assert.deepStrictEqual(result.verdict.strengths, ["Clear pricing", "Mobile first", "Fast"]);
      // The quote is in the snapshot (curly quotes are forgiven); the invented claim is dropped.
      assert.deepStrictEqual(result.verdict.receipts, ["“Plans from $12/month.”"]);
    }),
  );

  it.effect("snaps enum capitalisation to the canonical values", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() =>
        completion(JSON.stringify({ ...verdictJson, category: "developer tools", contentFlag: "None" })),
      );
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)));
      assert.strictEqual(result.verdict.category, "Developer Tools");
      assert.strictEqual(result.verdict.contentFlag, "none");
    }),
  );

  it.effect("reads JSON wrapped in a code fence or surrounded by prose", () =>
    Effect.gen(function* () {
      const fenced = fakeOpenRouter(() => completion("```json\n" + JSON.stringify(verdictJson) + "\n```"));
      const a = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(fenced.layer)));
      assert.strictEqual(a.verdict.score, 612);
      const chatty = fakeOpenRouter(() => completion("Here is the verdict: " + JSON.stringify(verdictJson) + " Done."));
      const b = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(chatty.layer)));
      assert.strictEqual(b.verdict.score, 612);
    }),
  );

  it("builds answer candidates from the raw text, the unfenced text and the outermost braces", () => {
    assert.deepStrictEqual(answerCandidates('```json\n{"a":1}\n```'), ['```json\n{"a":1}\n```', '{"a":1}']);
    assert.deepStrictEqual(answerCandidates("   "), []);
  });

  it.effect("rejects a score outside 1-1000 as invalid output", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => completion(JSON.stringify({ ...verdictJson, score: 1200 })));
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
      assert.strictEqual(error.reason, "invalid-output");
      assert.isTrue(error.retryable);
      assert.strictEqual(api.calls.length, 1); // bad output is not retried here; the queue decides
    }),
  );

  it.effect("treats a cut-off answer as retryable invalid output", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => completion('{"name": "Ac', { finish_reason: "length" }));
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
      assert.strictEqual(error.reason, "invalid-output");
      assert.isTrue(error.retryable);
      expect(error.message).toMatch(/max_tokens/);
    }),
  );

  it.effect("treats an empty answer as retryable invalid output", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => completion(null));
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
      assert.strictEqual(error.reason, "invalid-output");
      assert.isTrue(error.retryable);
    }),
  );

  it.effect("reports a refusal or a content filter as a final refusal", () =>
    Effect.gen(function* () {
      const refused = fakeOpenRouter(() => completion(null, { refusal: "I can't help with that." }));
      const a = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(refused.layer)), Effect.flip);
      assert.strictEqual(a.reason, "refused");
      assert.isFalse(a.retryable);
      const filtered = fakeOpenRouter(() => completion("", { finish_reason: "content_filter" }));
      const b = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(filtered.layer)), Effect.flip);
      assert.strictEqual(b.reason, "refused");
    }),
  );
});

describe("OpenRouterJudge errors", () => {
  const errorReply = (status: number, message: string): Reply => ({ status, body: { error: { code: status, message } } });

  it.effect("retries transient failures (429, 5xx, network) and then succeeds", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter((_, index) =>
        index === 0 ? errorReply(429, "Rate limited") : index === 1 ? "network-error" : ok,
      );
      const result = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)));
      assert.strictEqual(result.verdict.score, 612);
      assert.strictEqual(api.calls.length, 3);
    }),
  );

  it.effect("retries a provider error that arrives with a 200", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter((_, index) =>
        index === 0
          ? { status: 200, body: { choices: [{ finish_reason: "error", error: { code: 502, message: "Upstream died" } }] } }
          : ok,
      );
      yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)));
      assert.strictEqual(api.calls.length, 2);
    }),
  );

  it.effect("gives up after the retries with a retryable api error", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => errorReply(503, "Overloaded"));
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
      assert.strictEqual(error.reason, "api");
      assert.isTrue(error.retryable);
      assert.strictEqual(api.calls.length, 3);
    }),
  );

  it.effect("does not retry a bad request", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => errorReply(400, "response_format is not supported"));
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
      assert.strictEqual(error.reason, "api");
      assert.isFalse(error.retryable);
      expect(error.message).toContain("response_format is not supported");
      assert.strictEqual(api.calls.length, 1);
    }),
  );

  it.effect("maps a bad key or missing credits to a config error, moderation to a refusal", () =>
    Effect.gen(function* () {
      for (const [status, reason] of [
        [401, "config"],
        [402, "config"],
        [403, "refused"],
      ] as const) {
        const api = fakeOpenRouter(() => errorReply(status, `nope, key ${KEY}`));
        const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(Effect.provide(jevLayer(api.layer)), Effect.flip);
        assert.strictEqual(error.reason, reason);
        assert.isFalse(error.retryable);
        expect(error.message).not.toContain(KEY);
        assert.strictEqual(api.calls.length, 1);
      }
    }),
  );

  it.effect("fails with a config error when no key is configured", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => ok);
      const error = yield* Judge.use((judge) => judge.judge(judgeInput)).pipe(
        Effect.provide(layerWith().pipe(Layer.provide(api.layer), Layer.provide(AppConfig.layerTest()))),
        Effect.flip,
      );
      assert.strictEqual(error.reason, "config");
      assert.strictEqual(api.calls.length, 0);
    }),
  );
});

describe("OpenRouterJudge duels", () => {
  it.effect("asks for A or B with the duel schema and the duel effort", () =>
    Effect.gen(function* () {
      const api = fakeOpenRouter(() => completion(JSON.stringify({ winner: "B", reason: "  Beta helps more people.  " })));
      const verdict = yield* Judge.use((judge) => judge.duel(duelInput)).pipe(
        Effect.provide(jevLayer(api.layer, { duelEffort: "minimal" })),
      );
      assert.deepStrictEqual(verdict, { winner: "B", reason: "Beta helps more people." });
      const body = api.calls[0]!.body;
      assert.strictEqual(body["messages"][0].content, DUEL_SYSTEM_PROMPT);
      assert.strictEqual(body["response_format"].json_schema.name, "duel");
      assert.deepStrictEqual(body["reasoning"], { effort: "minimal", exclude: true });
    }),
  );
});
