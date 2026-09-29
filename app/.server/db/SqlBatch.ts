import { Context, Effect, Layer } from "effect";
import { SqlClient, type Statement } from "effect/sql";

/**
 * Runs a list of write statements atomically.
 *
 * Cloudflare D1 has no interactive transactions — only `batch()`, which runs
 * its statements in one implicit transaction. Code that needs atomic writes
 * builds its statements first and hands them to `SqlBatch.run`; the D1 layer
 * (see cloudflare/layers.ts) maps that to `D1Client.batch`, this SQLite layer
 * to a regular transaction (tests, seeding).
 */
export class SqlBatch extends Context.Service<
  SqlBatch,
  {
    readonly run: (statements: ReadonlyArray<Statement.Statement<unknown>>) => Effect.Effect<void>;
  }
>()("jevboard/db/SqlBatch") {
  static readonly layerTransaction = Layer.effect(
    SqlBatch,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return SqlBatch.of({
        run: (statements) =>
          Effect.forEach(statements, (statement) => statement, { discard: true }).pipe(
            sql.withTransaction,
            Effect.orDie,
            Effect.withSpan("SqlBatch.run", { attributes: { statements: statements.length } }),
          ),
      });
    }),
  );
}
