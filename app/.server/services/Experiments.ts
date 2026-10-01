import { Context, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { DEFAULT_VARIANTS, FLAGS, ONBOARDING_VARIANTS, pick, PRICE_VARIANTS, type Variants } from "~/lib/experiments";
import { AppConfig } from "../config";
import { LruCache } from "../og/lru";

export { DEFAULT_VARIANTS, FLAGS, parseVariantOverride, type OnboardingVariant, type PriceVariant, type Variants } from "~/lib/experiments";

/** One request to PostHog while the page renders: better the defaults than a slow page. */
const FLAGS_TIMEOUT = "500 millis";
/** How long (and for how many visitors) an isolate remembers assignments instead of asking again. */
const REMEMBER_MS = 10 * 60 * 1000;
const REMEMBERED_VISITORS = 5_000;
/** After a failed or slow answer, PostHog isn't asked again for this long. */
const PAUSE_AFTER_FAILURE_MS = 30 * 1000;

const FlagsResponse = Schema.Struct({
  flags: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ enabled: Schema.optional(Schema.Boolean), variant: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});
const decodeFlags = Schema.decodeUnknownOption(FlagsResponse);


/**
 * Which variants of the live tests a visitor sees, decided by PostHog's
 * feature flags so the split can be dialled up from PostHog. Evaluated on
 * the server so the first paint is already the right variant.
 */
export class Experiments extends Context.Service<
  Experiments,
  { readonly variantsFor: (distinctId: string) => Effect.Effect<Variants> }
>()("jevboard/Experiments") {
  static readonly layerNoDeps: Layer.Layer<Experiments, never, AppConfig | HttpClient.HttpClient> = Layer.effect(
    Experiments,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      if (Option.isNone(config.posthog)) {
        return Experiments.of({ variantsFor: () => Effect.succeed(DEFAULT_VARIANTS) });
      }
      const { token, host } = config.posthog.value;

      const ask = (distinctId: string) =>
        http
          .execute(
            HttpClientRequest.post(`${host}/flags?v=2`).pipe(
              HttpClientRequest.bodyJsonUnsafe({ api_key: token, distinct_id: distinctId, flag_keys_to_evaluate: Object.values(FLAGS) }),
            ),
          )
          .pipe(
            Effect.flatMap((response) => response.json),
            Effect.map((json): Variants => {
              const flags = Option.getOrUndefined(Option.flatMap(decodeFlags(json), (body) => Option.fromNullishOr(body.flags)));
              const onboarding = pick(ONBOARDING_VARIANTS, flags?.[FLAGS.onboarding]?.variant);
              const price = pick(PRICE_VARIANTS, flags?.[FLAGS.price]?.variant);
              return {
                onboarding: onboarding ?? DEFAULT_VARIANTS.onboarding,
                price: price ?? DEFAULT_VARIANTS.price,
                assigned: { onboarding: onboarding !== undefined, price: price !== undefined },
              };
            }),
            Effect.timeout(FLAGS_TIMEOUT),
          );

      // A visitor's answer is remembered for a while (per isolate), so browsing
      // around doesn't ask PostHog again; and when PostHog is failing, nobody
      // waits on it: everyone gets the defaults until it's had time to recover.
      const remembered = new LruCache<string, { readonly variants: Variants; readonly until: number }>(REMEMBERED_VISITORS);
      let pausedUntil = 0;

      const variantsFor = (distinctId: string) =>
        Effect.suspend(() => {
          const now = Date.now();
          const known = remembered.get(distinctId);
          if (known && known.until > now) return Effect.succeed(known.variants);
          if (pausedUntil > now) return Effect.succeed(DEFAULT_VARIANTS);
          return ask(distinctId).pipe(
            Effect.tap((variants) => Effect.sync(() => remembered.set(distinctId, { variants, until: Date.now() + REMEMBER_MS }))),
            Effect.catch((error) =>
              Effect.sync(() => {
                pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
              }).pipe(
                Effect.andThen(Effect.logWarning("PostHog flags unavailable, showing defaults", { error: String(error) })),
                Effect.as(DEFAULT_VARIANTS),
              ),
            ),
          );
        }).pipe(Effect.withSpan("Experiments.variantsFor"));

      return Experiments.of({ variantsFor });
    }),
  );

  static readonly layer: Layer.Layer<Experiments, never, AppConfig> = Experiments.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  /** Always the defaults (tests). */
  static readonly layerDefaults = Layer.succeed(Experiments, Experiments.of({ variantsFor: () => Effect.succeed(DEFAULT_VARIANTS) }));
}
