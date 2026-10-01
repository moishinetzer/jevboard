import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Crawler } from "./Crawler";

export interface StoredIcon {
  readonly contentType: string;
  /** Backed by a plain ArrayBuffer (valid as a Response body everywhere). */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** When it was copied; versions its address (/icon/<site>?v=…). */
  readonly version: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/**
 * Our own copies of the businesses' logos. A row's picture is copied from the
 * business's site when Jev judges it and served from /icon/<site>, so the
 * board shows what Jev saw (an owner can't swap it afterwards) and visitors'
 * browsers never call the business's server.
 */
export class Icons extends Context.Service<
  Icons,
  {
    /**
     * Copies the icon at `url` for `siteKey`. Gives the copy's version, or
     * null when there's nothing usable (no address, unreachable, not a plain
     * picture, too big); an earlier copy is kept then. Never fails.
     */
    readonly copy: (siteKey: string, url: string | null) => Effect.Effect<number | null>;
    /** The copy for a business that's listed on the board. */
    readonly get: (siteKey: string) => Effect.Effect<Option.Option<StoredIcon>>;
  }
>()("jevboard/Icons") {
  static readonly layer = Layer.effect(
    Icons,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const crawler = yield* Crawler;

      const copy = Effect.fn("Icons.copy")(function* (siteKey: string, url: string | null) {
        if (url === null) return null;
        const fetched = yield* crawler.fetchIcon(url).pipe(
          Effect.catch((error) => Effect.logInfo("Icon not copied", { siteKey, url, reason: error.message }).pipe(Effect.as(null))),
        );
        if (fetched === null) return null;
        const now = Date.now();
        yield* sql`
          INSERT INTO site_icons (site_key, content_type, body, source_url, created_at)
          VALUES (${siteKey}, ${fetched.contentType}, ${toBase64(fetched.bytes)}, ${url}, ${now})
          ON CONFLICT (site_key) DO UPDATE SET
            content_type = excluded.content_type, body = excluded.body,
            source_url = excluded.source_url, created_at = excluded.created_at`.pipe(Effect.orDie);
        return now;
      });

      const get = Effect.fn("Icons.get")(function* (siteKey: string) {
        const rows = yield* sql<{ readonly contentType: string; readonly body: string; readonly createdAt: number }>`
          SELECT i.content_type, i.body, i.created_at FROM site_icons i
          JOIN entries e ON e.site_key = i.site_key
          WHERE i.site_key = ${siteKey} AND e.hidden = 0`;
        return Option.map(Option.fromNullishOr(rows[0]), (row) => ({
          contentType: row.contentType,
          bytes: fromBase64(row.body),
          version: row.createdAt,
        }));
      }, Effect.orDie);

      return Icons.of({ copy, get });
    }),
  );
}
