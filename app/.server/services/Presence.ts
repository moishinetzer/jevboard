import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

const WINDOW_MS = 90_000;
/** Each isolate writes a visitor's heartbeat at most this often. */
const WRITE_EVERY_MS = 30_000;

/**
 * "N people watching right now": heartbeats stored in the `presence` table
 * (shared by every Worker isolate), throttled per isolate so a busy page
 * doesn't turn into a write per request. The cron trigger prunes old rows.
 */
export class Presence extends Context.Service<
  Presence,
  {
    readonly heartbeat: (visitorId: string) => Effect.Effect<void>;
    readonly online: Effect.Effect<number>;
  }
>()("jevboard/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const lastWrite = new Map<string, number>();

      const heartbeat = Effect.fn("Presence.heartbeat")(function* (visitorId: string) {
        const now = Date.now();
        if (now - (lastWrite.get(visitorId) ?? 0) < WRITE_EVERY_MS) return;
        lastWrite.set(visitorId, now);
        if (lastWrite.size > 10_000) lastWrite.clear();
        yield* sql`
          INSERT INTO presence (visitor_id, last_seen_at) VALUES (${visitorId}, ${now})
          ON CONFLICT (visitor_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`;
      }, Effect.orDie);

      return Presence.of({
        heartbeat,
        // Re-evaluated per call so the window moves with the clock.
        online: Effect.suspend(() =>
          sql<{ online: number }>`
            SELECT COUNT(*) AS online FROM presence WHERE last_seen_at >= ${Date.now() - WINDOW_MS}`.pipe(
            Effect.map((rows) => Math.max(1, rows[0]?.online ?? 0)),
            Effect.orDie,
          ),
        ).pipe(Effect.withSpan("Presence.online")),
      });
    }),
  );
}
