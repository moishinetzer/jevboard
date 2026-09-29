import { Config, Context, Effect, Layer, Option, Redacted } from "effect";

/**
 * All runtime configuration, read once from the environment.
 *
 * Missing provider keys are fine in development: the app falls back to a
 * simulated checkout and a deterministic mock judge so it runs end-to-end
 * locally. In production those fallbacks must be opted into explicitly.
 */
export interface AppConfigShape {
  readonly env: "development" | "production" | "test";
  readonly databasePath: string;
  /** Canonical public origin, e.g. https://jevboard.com (no trailing slash). */
  readonly publicUrl: Option.Option<string>;
  readonly anthropic: Option.Option<{
    readonly apiKey: Redacted.Redacted<string>;
    readonly model: string;
    readonly judgeEffort: "low" | "medium" | "high" | "xhigh" | "max";
    readonly duelEffort: "low" | "medium" | "high" | "xhigh" | "max";
  }>;
  readonly autumn: Option.Option<{
    readonly secretKey: Redacted.Redacted<string>;
    /** e.g. https://api.useautumn.com/v1 */
    readonly apiUrl: string;
    /** Sent as `x-api-version`; response shapes depend on it. */
    readonly apiVersion: string;
    /** One-off $5 plan that grants one judgment credit. */
    readonly planId: string;
    /** Consumable feature the plan grants. */
    readonly featureId: string;
    /** Svix signing secret for Autumn webhooks (optional; polling works without it). */
    readonly webhookSecret: Option.Option<Redacted.Redacted<string>>;
  }>;
  /** Number of concurrent judgment workers. */
  readonly workers: number;
  readonly crawlUserAgent: string;
}

const Effort = (name: string, fallback: "low" | "medium" | "high") =>
  Config.Literals(["low", "medium", "high", "xhigh", "max"], name).pipe(Config.withDefault(fallback));

const config = Effect.gen(function* () {
  const env = yield* Config.Literals(["development", "production", "test"], "NODE_ENV").pipe(
    Config.withDefault("development" as const),
  );
  const databasePath = yield* Config.String("DATABASE_PATH").pipe(Config.withDefault("./data/jevboard.db"));
  const publicUrl = yield* Config.option(Config.String("PUBLIC_URL"));

  const anthropicKey = yield* Config.option(Config.Redacted("ANTHROPIC_API_KEY"));
  const model = yield* Config.String("JEV_MODEL").pipe(Config.withDefault("claude-opus-5-5"));
  const judgeEffort = yield* Effort("JEV_JUDGE_EFFORT", "medium");
  const duelEffort = yield* Effort("JEV_DUEL_EFFORT", "low");

  const autumnKey = yield* Config.option(Config.Redacted("AUTUMN_SECRET_KEY"));
  const autumnApiUrl = yield* Config.String("AUTUMN_API_URL").pipe(Config.withDefault("https://api.useautumn.com/v1"));
  const autumnApiVersion = yield* Config.String("AUTUMN_API_VERSION").pipe(Config.withDefault("2.4.0"));
  const planId = yield* Config.String("AUTUMN_PLAN_ID").pipe(Config.withDefault("judgment"));
  const featureId = yield* Config.String("AUTUMN_FEATURE_ID").pipe(Config.withDefault("judgment"));
  const webhookSecret = yield* Config.option(Config.Redacted("AUTUMN_WEBHOOK_SECRET"));

  const allowFakePayments = yield* Config.Boolean("JEV_ALLOW_FAKE_PAYMENTS").pipe(Config.withDefault(false));
  const allowMockJudge = yield* Config.Boolean("JEV_ALLOW_MOCK_JUDGE").pipe(Config.withDefault(false));
  const workers = yield* Config.Int("JEV_WORKERS").pipe(Config.withDefault(2));
  const crawlUserAgent = yield* Config.String("JEV_USER_AGENT").pipe(
    Config.withDefault("Mozilla/5.0 (compatible; JevBot/1.0; +https://jevboard.com/faq#jevbot)"),
  );

  if (env === "production") {
    if (Option.isNone(autumnKey) && !allowFakePayments) {
      return yield* Effect.die(
        new Error("AUTUMN_SECRET_KEY is required in production (set JEV_ALLOW_FAKE_PAYMENTS=true to override)."),
      );
    }
    if (Option.isNone(anthropicKey) && !allowMockJudge) {
      return yield* Effect.die(
        new Error("ANTHROPIC_API_KEY is required in production (set JEV_ALLOW_MOCK_JUDGE=true to override)."),
      );
    }
  }

  return {
    env,
    databasePath,
    publicUrl: Option.map(publicUrl, (url) => url.replace(/\/+$/, "")),
    anthropic: Option.map(anthropicKey, (apiKey) => ({ apiKey, model, judgeEffort, duelEffort })),
    autumn: Option.map(autumnKey, (secretKey) => ({
      secretKey,
      apiUrl: autumnApiUrl.replace(/\/+$/, ""),
      apiVersion: autumnApiVersion,
      planId,
      featureId,
      webhookSecret,
    })),
    workers: Math.max(1, Math.min(workers, 8)),
    crawlUserAgent,
  } satisfies AppConfigShape;
});

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("jevboard/AppConfig") {
  static readonly layer = Layer.effect(AppConfig, config);

  /** Fixed config for tests. */
  static readonly layerTest = (overrides: Partial<AppConfigShape> = {}) =>
    Layer.succeed(
      AppConfig,
      AppConfig.of({
        env: "test",
        databasePath: ":memory:",
        publicUrl: Option.none(),
        anthropic: Option.none(),
        autumn: Option.none(),
        workers: 1,
        crawlUserAgent: "JevBot/test",
        ...overrides,
      }),
    );
}
