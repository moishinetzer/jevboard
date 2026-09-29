import { Context, Effect, Layer } from "effect";

/**
 * Fixed-window, in-memory rate limiting (single instance deployment).
 * Used to stop the submit form from being abused as a free crawler / DoS
 * amplifier: every submission triggers an outbound reachability check.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    /** Counts a hit for `key`; true if it is within `limit` hits per `windowMs`. */
    readonly hit: (key: string, limit: number, windowMs: number) => Effect.Effect<boolean>;
  }
>()("jevboard/RateLimiter") {
  static readonly layer = Layer.sync(RateLimiter, () => {
    const windows = new Map<string, { start: number; count: number }>();
    let lastSweep = Date.now();

    return RateLimiter.of({
      hit: (key, limit, windowMs) =>
        Effect.sync(() => {
          const now = Date.now();
          if (now - lastSweep > 60_000) {
            for (const [k, w] of windows) if (now - w.start > windowMs) windows.delete(k);
            lastSweep = now;
          }
          const current = windows.get(key);
          if (!current || now - current.start >= windowMs) {
            windows.set(key, { start: now, count: 1 });
            return true;
          }
          current.count++;
          return current.count <= limit;
        }),
    });
  });
}
