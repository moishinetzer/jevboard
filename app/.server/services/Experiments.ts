import { Context, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { DEFAULT_VARIANTS, FLAGS, ONBOARDING_VARIANTS, pick, PRICE_VARIANTS, type Variants } from "~/lib/experiments";
import { AppConfig } from "../config";

export { DEFAULT_VARIANTS, FLAGS, parseVariantOverride, type OnboardingVariant, type PriceVariant, type Variants } from "~/lib/experiments";

/** One request to PostHog while the page renders: better the defaults than a slow page. */
const FLAGS_TIMEOUT = "700 millis";

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

      const variantsFor = (distinctId: string) =>
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
            Effect.catch((error) =>
              Effect.logWarning("PostHog flags unavailable, showing defaults", { error: String(error) }).pipe(Effect.as(DEFAULT_VARIANTS)),
            ),
            Effect.withSpan("Experiments.variantsFor"),
          );

      return Experiments.of({ variantsFor });
    }),
  );

  static readonly layer: Layer.Layer<Experiments, never, AppConfig> = Experiments.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer));

  /** Always the defaults (tests). */
  static readonly layerDefaults = Layer.succeed(Experiments, Experiments.of({ variantsFor: () => Effect.succeed(DEFAULT_VARIANTS) }));
}
