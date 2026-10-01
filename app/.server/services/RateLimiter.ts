import { Context, Effect, Layer } from "effect";

/** "preview" is one site-wide budget for uncached onboarding previews (PREVIEW_LIMITER). */
export type RateLimitBucket = "visitor" | "ip" | "preview";

/**
 * Submission rate limiting: every submission triggers an outbound
 * reachability check, so the form must not become a free crawler.
 *
 * On Cloudflare this is backed by the Workers Rate Limiting bindings
 * (VISITOR_LIMITER / IP_LIMITER, configured in wrangler.jsonc — see
 * cloudflare/layers.ts). `layerAllowAll` is for tests and scripts.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** True if another submission is allowed for `key` in `bucket`. */
    readonly allow: (bucket: RateLimitBucket, key: string) => Effect.Effect<boolean>;
  }
>()("jevboard/RateLimiter") {
  static readonly layerAllowAll = Layer.succeed(RateLimiter, RateLimiter.of({ allow: () => Effect.succeed(true) }));
}
