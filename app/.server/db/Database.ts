import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, String as Str } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppConfig } from "../config";

/**
 * Schema migrations. Append only — never edit a migration that has shipped.
 *
 * Timestamps are epoch milliseconds (INTEGER). JSON arrays are stored as TEXT.
 */
const migrations = Migrator.fromRecord({
  "0001_init": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        site_key TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        host TEXT NOT NULL,
        name TEXT NOT NULL,
        tldr TEXT NOT NULL,
        verdict TEXT NOT NULL,
        category TEXT NOT NULL,
        label TEXT NOT NULL,
        subscores TEXT NOT NULL,
        score INTEGER NOT NULL,
        tie_rank INTEGER NOT NULL DEFAULT 0,
        judgment_id TEXT NOT NULL,
        rolls INTEGER NOT NULL DEFAULT 1,
        best_score INTEGER NOT NULL,
        worst_score INTEGER NOT NULL,
        last_delta INTEGER NOT NULL DEFAULT 0,
        manipulation_attempt INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        content_flag TEXT NOT NULL DEFAULT 'none',
        og_image TEXT,
        entry_number INTEGER NOT NULL,
        clicks INTEGER NOT NULL DEFAULT 0,
        first_judged_at INTEGER NOT NULL,
        last_judged_at INTEGER NOT NULL
      )`;
    yield* sql`CREATE INDEX entries_rank_idx ON entries (hidden, score DESC, tie_rank ASC)`;
    yield* sql`CREATE INDEX entries_recent_idx ON entries (last_judged_at DESC)`;

    yield* sql`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        site_key TEXT NOT NULL,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        stage_detail TEXT,
        error TEXT,
        amount_cents INTEGER NOT NULL,
        entry_id TEXT,
        judgment_id TEXT,
        created_at INTEGER NOT NULL,
        paid_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL
      )`;
    yield* sql`CREATE INDEX orders_status_idx ON orders (status)`;
    yield* sql`CREATE INDEX orders_site_idx ON orders (site_key)`;

    yield* sql`
      CREATE TABLE judgments (
        id TEXT PRIMARY KEY,
        serial INTEGER NOT NULL UNIQUE,
        entry_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        roll INTEGER NOT NULL,
        score INTEGER NOT NULL,
        previous_score INTEGER,
        rank_at_placement INTEGER NOT NULL,
        name TEXT NOT NULL,
        tldr TEXT NOT NULL,
        verdict TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        category TEXT NOT NULL,
        label TEXT NOT NULL,
        subscores TEXT NOT NULL,
        strengths TEXT NOT NULL,
        weaknesses TEXT NOT NULL,
        receipts TEXT NOT NULL,
        manipulation_attempt INTEGER NOT NULL DEFAULT 0,
        content_flag TEXT NOT NULL DEFAULT 'none',
        pages_crawled TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`;
    yield* sql`CREATE INDEX judgments_entry_idx ON judgments (entry_id, roll)`;

    yield* sql`
      CREATE TABLE duels (
        id TEXT PRIMARY KEY,
        judgment_id TEXT NOT NULL,
        challenger_id TEXT NOT NULL,
        opponent_id TEXT NOT NULL,
        winner_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`;
    yield* sql`CREATE INDEX duels_judgment_idx ON duels (judgment_id)`;
    yield* sql`CREATE INDEX duels_challenger_idx ON duels (challenger_id)`;
    yield* sql`CREATE INDEX duels_opponent_idx ON duels (opponent_id)`;

    yield* sql`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        entry_id TEXT,
        site_key TEXT,
        other_site_key TEXT,
        score INTEGER,
        rank INTEGER,
        delta INTEGER,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`;

    yield* sql`
      CREATE TABLE reigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      )`;

    yield* sql`
      CREATE TABLE visitors (
        id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL
      )`;
  }),
});

/** SQLite client configured from `DATABASE_PATH`, with migrations applied. */
export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (config.databasePath !== ":memory:") {
      mkdirSync(dirname(config.databasePath), { recursive: true });
    }
    const client = SqliteClient.layer({
      filename: config.databasePath,
      // Rows come back camelCased; insert/update helpers write snake_case columns.
      transformResultNames: Str.snakeToCamel,
      transformQueryNames: Str.camelToSnake,
    });
    const migrate = SqliteMigrator.layer({ loader: migrations });
    return migrate.pipe(Layer.provideMerge(client), Layer.orDie);
  }),
);
