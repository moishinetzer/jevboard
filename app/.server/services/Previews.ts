import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { SitePreview } from "../domain/models";

/** A site's onboarding read: how it presents itself, and what Jev made of it. */
export const CachedPreview = Schema.Struct({
  profile: Schema.Struct({ title: Schema.String, description: Schema.String, icon: Schema.NullOr(Schema.String) }),
  preview: SitePreview,
});
export type CachedPreview = typeof CachedPreview.Type;

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(CachedPreview));

/**
 * The guided onboarding's reads, cached per site so a refresh, a back button
 * or a second visitor doesn't pay for the crawl and the model call again.
 */
export class Previews extends Context.Service<
  Previews,
  {
    /** The cached read for `siteKey`, if it's younger than `maxAgeMs`. */
    readonly get: (siteKey: string, maxAgeMs: number) => Effect.Effect<Option.Option<CachedPreview>>;
    readonly put: (siteKey: string, value: CachedPreview) => Effect.Effect<void>;
  }
>()("jevboard/Previews") {
  static readonly layer = Layer.effect(
    Previews,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const get = Effect.fn("Previews.get")(function* (siteKey: string, maxAgeMs: number) {
        const rows = yield* sql<{ readonly json: string }>`
          SELECT json FROM site_previews WHERE site_key = ${siteKey} AND created_at >= ${Date.now() - maxAgeMs}`;
        return Option.flatMap(Option.fromNullishOr(rows[0]), (row) => decode(row.json));
      }, Effect.orDie);

      const put = Effect.fn("Previews.put")(function* (siteKey: string, value: CachedPreview) {
        const json = JSON.stringify(value);
        const now = Date.now();
        yield* sql`
          INSERT INTO site_previews (site_key, json, created_at) VALUES (${siteKey}, ${json}, ${now})
          ON CONFLICT (site_key) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`;
      }, Effect.orDie);

      return Previews.of({ get, put });
    }),
  );
}
