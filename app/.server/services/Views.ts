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
    /**
     * Views per day over the last `days` days (oldest first, zero-filled, the
     * same days as `daily`) for each site key. Keys nobody viewed are left out.
     */
    readonly dailyMany: (
      siteKeys: ReadonlyArray<string>,
      days: number,
    ) => Effect.Effect<ReadonlyMap<string, ReadonlyArray<number>>>;
    /** Every view ever counted for each site key. Keys nobody viewed are left out. */
    readonly allTime: (siteKeys: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, number>>;
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

      const dailyMany = Effect.fn("Views.dailyMany")(function* (siteKeys: ReadonlyArray<string>, days: number) {
        if (siteKeys.length === 0) return new Map<string, ReadonlyArray<number>>();
        const now = Date.now();
        const labels = Array.from({ length: days }, (_, index) => utcDay(now - (days - 1 - index) * DAY_MS));
        const slot = new Map(labels.map((day, index) => [day, index]));
        const rows = yield* sql<{ readonly siteKey: string; readonly day: string; readonly count: number }>`
          SELECT site_key, day, count FROM views
          WHERE day >= ${labels[0]} AND site_key IN ${sql.in(siteKeys)}`;
        const counts = new Map<string, Array<number>>();
        for (const row of rows) {
          const index = slot.get(row.day);
          if (index === undefined) continue;
          let series = counts.get(row.siteKey);
          if (!series) counts.set(row.siteKey, (series = Array.from({ length: days }, () => 0)));
          series[index] = Number(row.count);
        }
        return counts as ReadonlyMap<string, ReadonlyArray<number>>;
      }, Effect.orDie);

      const allTime = Effect.fn("Views.allTime")(function* (siteKeys: ReadonlyArray<string>) {
        if (siteKeys.length === 0) return new Map<string, number>();
        const rows = yield* sql<{ readonly siteKey: string; readonly views: number }>`
          SELECT site_key, SUM(count) AS views FROM views
          WHERE site_key IN ${sql.in(siteKeys)}
          GROUP BY site_key`;
        return new Map(rows.map((row) => [row.siteKey, Number(row.views)]));
      }, Effect.orDie);

      return Views.of({ record, daily, dailyMany, allTime });
    }),
  );
}
