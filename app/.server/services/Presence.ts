import { Context, Effect, Layer } from "effect";

const WINDOW_MS = 90_000;

/**
 * "N people watching right now". In-memory heartbeat map keyed by visitor id;
 * every page load and every live-feed poll counts as a heartbeat.
 */
export class Presence extends Context.Service<
  Presence,
  {
    readonly heartbeat: (visitorId: string) => Effect.Effect<void>;
    readonly online: Effect.Effect<number>;
  }
>()("jevboard/Presence") {
  static readonly layer = Layer.sync(Presence, () => {
    const lastSeen = new Map<string, number>();

    const prune = (now: number) => {
      for (const [id, seen] of lastSeen) {
        if (now - seen > WINDOW_MS) lastSeen.delete(id);
      }
    };

    return Presence.of({
      heartbeat: (visitorId) =>
        Effect.sync(() => {
          const now = Date.now();
          lastSeen.set(visitorId, now);
          if (lastSeen.size > 5_000) prune(now);
        }),
      online: Effect.sync(() => {
        prune(Date.now());
        return Math.max(1, lastSeen.size);
      }),
    });
  });
}
