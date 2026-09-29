import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, Layer, String as Str } from "effect";
import { SqlClient } from "effect/sql";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SqlBatch } from "~/.server/db/SqlBatch";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations");

/** Splits a migration file into statements (our migrations have no triggers or string semicolons). */
const statementsOf = (file: string): ReadonlyArray<string> =>
  readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/** Applies the same SQL migrations wrangler applies to D1. */
const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    for (const statement of statementsOf(file)) yield* sql.unsafe(statement);
  }
}).pipe(Effect.orDie);

/**
 * Node SQLite with the D1 schema, for tests and scripts. Provides SqlClient
 * and a transaction-backed SqlBatch (D1's batch semantics).
 */
export const SqliteLocal = (filename = ":memory:") =>
  Layer.effectDiscard(migrate).pipe(
    Layer.provideMerge(SqlBatch.layerTransaction),
    Layer.provideMerge(
      SqliteClient.layer({
        filename,
        transformResultNames: Str.snakeToCamel,
        transformQueryNames: Str.camelToSnake,
      }),
    ),
  );
