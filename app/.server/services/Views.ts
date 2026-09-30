import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

/** One UTC day of views, e.g. `{ day: "2026-09-30", views: 42 }`. */
export interface ViewDay {
  readonly day: string;
  readonly views: number;
}

/** The `site_key` that counts views of the whole board. */
export const BOARD_VIEWS = "";

const DAY_MS = 24 * 3600 * 1000;
const utcDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

/**
 * Page views per day, for the board as a whole and per business. Counting is
 * best effort: a failed write is logged and never breaks the page.
 */
export class Views extends Context.Service<
  Views,
  {
    /** Adds one view today to each site key (use BOARD_VIEWS for the board). */
    readonly record: (siteKeys: ReadonlyArray<string>) => Effect.Effect<void>;
    /** The last `days` days, oldest first, with zeros for days nobody looked. */
    readonly daily: (siteKey: string, days: number) => Effect.Effect<ReadonlyArray<ViewDay>>;
  }
>()("jevboard/Views") {
  static readonly layer = Layer.effect(
    Views,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const record = (siteKeys: ReadonlyArray<string>) => {
        const day = utcDay(Date.now());
        return Effect.forEach(
          siteKeys,
          (siteKey) => sql`
            INSERT INTO views (site_key, day, count) VALUES (${siteKey}, ${day}, 1)
            ON CONFLICT (site_key, day) DO UPDATE SET count = count + 1`,
          { discard: true },
        ).pipe(
          Effect.tapError((error) => Effect.logWarning("Could not record a page view", { error: error.message })),
          Effect.ignore,
          Effect.withSpan("Views.record"),
        );
      };

      const daily = Effect.fn("Views.daily")(function* (siteKey: string, days: number) {
        const now = Date.now();
        const first = utcDay(now - (days - 1) * DAY_MS);
        const rows = yield* sql<{ readonly day: string; readonly count: number }>`
          SELECT day, count FROM views WHERE site_key = ${siteKey} AND day >= ${first}`;
        const byDay = new Map(rows.map((row) => [row.day, row.count]));
        return Array.from({ length: days }, (_, index): ViewDay => {
          const day = utcDay(now - (days - 1 - index) * DAY_MS);
          return { day, views: byDay.get(day) ?? 0 };
        });
      }, Effect.orDie);

      return Views.of({ record, daily });
    }),
  );
}
