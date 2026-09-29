import { Context, Effect, Layer, Option } from "effect";
import { SqlClient, type Statement } from "effect/sql";
import { NotFound } from "../domain/errors";
import { type EntryId, type JudgmentId, makeEntryId, makeJudgmentId, type OrderId, randomId } from "../domain/ids";
import {
  type BoardEntry,
  type BoardEvent,
  type BoardStats,
  type ContentFlag,
  type Duel,
  type DuelContender,
  type EventKind,
  IN_FLIGHT_STATUSES,
  type Judgment,
  type Reign,
  type SiteSnapshot,
  type SubScores,
  type Verdict,
} from "../domain/models";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface EntryRow {
  readonly id: string;
  readonly siteKey: string;
  readonly url: string;
  readonly host: string;
  readonly name: string;
  readonly tldr: string;
  readonly verdict: string;
  readonly category: string;
  readonly label: string;
  readonly subscores: string;
  readonly score: number;
  readonly tieRank: number;
  readonly judgmentId: string;
  readonly rolls: number;
  readonly bestScore: number;
  readonly worstScore: number;
  readonly lastDelta: number;
  readonly manipulationAttempt: number;
  readonly hidden: number;
  readonly contentFlag: string;
  readonly ogImage: string | null;
  readonly entryNumber: number;
  readonly clicks: number;
  readonly firstJudgedAt: number;
  readonly lastJudgedAt: number;
}

interface RankedEntryRow extends EntryRow {
  readonly rank: number;
}

interface JudgmentRow {
  readonly id: string;
  readonly serial: number;
  readonly entryId: string;
  readonly orderId: string;
  readonly roll: number;
  readonly score: number;
  readonly previousScore: number | null;
  readonly rankAtPlacement: number;
  readonly name: string;
  readonly tldr: string;
  readonly verdict: string;
  readonly reasoning: string;
  readonly category: string;
  readonly label: string;
  readonly subscores: string;
  readonly strengths: string;
  readonly weaknesses: string;
  readonly receipts: string;
  readonly manipulationAttempt: number;
  readonly contentFlag: string;
  readonly pagesCrawled: string;
  readonly model: string;
  readonly createdAt: number;
}

const parseList = (json: string): ReadonlyArray<string> => {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const EMPTY_SUBSCORES: SubScores = { clarity: 0, demand: 0, originality: 0, trust: 0, wouldJevPay: 0 };

const parseSubScores = (json: string): SubScores => {
  try {
    const value = JSON.parse(json) as Partial<Record<keyof SubScores, unknown>>;
    const pick = (key: keyof SubScores) => (typeof value[key] === "number" ? (value[key] as number) : 0);
    return {
      clarity: pick("clarity"),
      demand: pick("demand"),
      originality: pick("originality"),
      trust: pick("trust"),
      wouldJevPay: pick("wouldJevPay"),
    };
  } catch {
    return EMPTY_SUBSCORES;
  }
};

const toContentFlag = (flag: string): ContentFlag =>
  (["none", "adult", "illegal", "scam", "hateful", "parked"] as const).find((known) => known === flag) ?? "none";

const toBoardEntry = (row: RankedEntryRow): BoardEntry => ({
  id: row.id as EntryId,
  siteKey: row.siteKey,
  url: row.url,
  host: row.host,
  name: row.name,
  tldr: row.tldr,
  verdict: row.verdict,
  category: row.category,
  score: row.score,
  rank: row.rank,
  rolls: row.rolls,
  bestScore: row.bestScore,
  worstScore: row.worstScore,
  lastDelta: row.lastDelta,
  manipulationAttempt: row.manipulationAttempt === 1,
  label: row.label,
  subscores: parseSubScores(row.subscores),
  ogImage: row.ogImage,
  entryNumber: row.entryNumber,
  clicks: row.clicks,
  firstJudgedAt: row.firstJudgedAt,
  lastJudgedAt: row.lastJudgedAt,
});

const toJudgment = (row: JudgmentRow): Judgment => ({
  id: row.id as JudgmentId,
  serial: row.serial,
  entryId: row.entryId as EntryId,
  orderId: row.orderId as OrderId,
  roll: row.roll,
  score: row.score,
  previousScore: row.previousScore,
  rankAtPlacement: row.rankAtPlacement,
  name: row.name,
  tldr: row.tldr,
  verdict: row.verdict,
  reasoning: row.reasoning,
  category: row.category,
  label: row.label,
  subscores: parseSubScores(row.subscores),
  strengths: parseList(row.strengths),
  weaknesses: parseList(row.weaknesses),
  receipts: parseList(row.receipts),
  manipulationAttempt: row.manipulationAttempt === 1,
  contentFlag: toContentFlag(row.contentFlag),
  pagesCrawled: parseList(row.pagesCrawled),
  model: row.model,
  createdAt: row.createdAt,
});

// ---------------------------------------------------------------------------
// Placement types
// ---------------------------------------------------------------------------

/** A member of a tie group, best-placed first. */
export interface TiedEntry {
  readonly id: EntryId;
  readonly siteKey: string;
  readonly contender: DuelContender;
}

export interface DuelRecord {
  readonly opponentId: EntryId;
  readonly opponentSiteKey: string;
  /** True when the entry being placed won. */
  readonly challengerWon: boolean;
  readonly reason: string;
}

export interface CommitPlacementInput {
  readonly orderId: OrderId;
  readonly siteKey: string;
  readonly url: string;
  readonly host: string;
  readonly verdict: Verdict;
  readonly snapshot: SiteSnapshot;
  readonly model: string;
  readonly pagesCrawled: ReadonlyArray<string>;
  /**
   * Final order of the tie group at `verdict.score`, best first, with the
   * placed entry marked by `null` (its id may not exist yet).
   */
  readonly tieOrder: ReadonlyArray<EntryId | null>;
  readonly duels: ReadonlyArray<DuelRecord>;
}

export interface PlacementResult {
  readonly entryId: EntryId;
  readonly judgmentId: JudgmentId;
  readonly siteKey: string;
  readonly roll: number;
  readonly score: number;
  readonly previousScore: number | null;
  readonly rank: number;
  readonly previousRank: number | null;
  readonly crowned: boolean;
  /** True when Jev flagged the site (adult, scam, parked, ...) and kept it off the board. */
  readonly hidden: boolean;
}

export interface Hall {
  readonly reigns: ReadonlyArray<Reign>;
  readonly mostRerolled: ReadonlyArray<BoardEntry>;
  readonly lowest: ReadonlyArray<BoardEntry>;
  readonly bribers: ReadonlyArray<BoardEntry>;
  readonly biggestJumps: ReadonlyArray<Judgment & { readonly siteKey: string }>;
  readonly biggestDrops: ReadonlyArray<Judgment & { readonly siteKey: string }>;
  readonly duelChampions: ReadonlyArray<{ readonly siteKey: string; readonly name: string; readonly wins: number; readonly losses: number }>;
}

export const BOARD_SORTS = ["rank", "today", "week", "newest", "rerolled"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export interface BoardQuery {
  readonly page: number;
  readonly pageSize: number;
  /** Free-text filter over site, name and category. */
  readonly query?: string | undefined;
  readonly category?: string | undefined;
  /**
   * rank: all-time board. today/week: entries judged in the last 24h / 7d, by rank.
   * newest: most recently judged first. rerolled: most rolls first.
   */
  readonly sort?: BoardSort | undefined;
}

export interface DailyStat {
  /** YYYY-MM-DD (UTC) */
  readonly day: string;
  readonly judgments: number;
  readonly rerolls: number;
  readonly revenueCents: number;
}

export interface BoardPage {
  readonly entries: ReadonlyArray<BoardEntry>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// ---------------------------------------------------------------------------
// Event copy for the ticker
// ---------------------------------------------------------------------------

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "±0");

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * The leaderboard: ranked entries, their judgment history, tiebreak duels,
 * the live event feed, reigns at #1, and aggregate stats.
 *
 * Ranking is `score DESC, tie_rank ASC`: tie_rank is the order Jev decided
 * through duels among entries sharing an exact score.
 */
export class Board extends Context.Service<
  Board,
  {
    readonly findBySiteKey: (siteKey: string) => Effect.Effect<Option.Option<BoardEntry>>;
    readonly getBySiteKey: (siteKey: string) => Effect.Effect<BoardEntry, NotFound>;
    readonly getById: (id: string) => Effect.Effect<BoardEntry, NotFound>;
    readonly page: (options: BoardQuery) => Effect.Effect<BoardPage>;
    readonly top: (limit: number) => Effect.Effect<ReadonlyArray<BoardEntry>>;
    readonly recent: (limit: number) => Effect.Effect<ReadonlyArray<BoardEntry>>;
    /** Visible entries currently at `score`, best first, excluding the site being placed. */
    readonly tiedGroup: (score: number, excludeSiteKey: string) => Effect.Effect<ReadonlyArray<TiedEntry>>;
    /** Atomically writes a finished judgment and its placement. */
    readonly commitPlacement: (input: CommitPlacementInput) => Effect.Effect<PlacementResult>;
    readonly judgments: (entryId: EntryId) => Effect.Effect<ReadonlyArray<Judgment>>;
    readonly judgment: (id: string) => Effect.Effect<Option.Option<Judgment>>;
    readonly duelsForEntry: (entryId: EntryId, limit: number) => Effect.Effect<ReadonlyArray<Duel>>;
    readonly duelsForJudgment: (judgmentId: string) => Effect.Effect<ReadonlyArray<Duel>>;
    readonly events: (options: { readonly afterId?: number | undefined; readonly limit: number }) => Effect.Effect<ReadonlyArray<BoardEvent>>;
    readonly stats: Effect.Effect<BoardStats>;
    readonly hall: Effect.Effect<Hall>;
    /** Entries directly above and below, for "neighbours" on the entry page. */
    readonly neighbours: (entryId: EntryId, radius: number) => Effect.Effect<ReadonlyArray<BoardEntry>>;
    /** Counts an outbound visit and returns the URL to redirect to. */
    readonly recordClick: (siteKey: string) => Effect.Effect<Option.Option<string>>;
    /** Registers a first-time visitor id (idempotent). */
    readonly recordVisitor: (visitorId: string) => Effect.Effect<void>;
    /** Per-day judgments, rerolls and revenue for the last `days` days (UTC), oldest first. */
    readonly daily: (days: number) => Effect.Effect<ReadonlyArray<DailyStat>>;
    /** Categories that currently have at least one entry, with counts. */
    readonly categories: Effect.Effect<ReadonlyArray<{ readonly category: string; readonly count: number }>>;
  }
>()("jevboard/Board") {
  static readonly layer = Layer.effect(
    Board,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const ranked = sql`
        SELECT e.*, ROW_NUMBER() OVER (ORDER BY e.score DESC, e.tie_rank ASC, e.first_judged_at ASC) AS rank
        FROM entries e WHERE e.hidden = 0`;

      const findBySiteKey = Effect.fn("Board.findBySiteKey")(function* (siteKey: string) {
        const rows = yield* sql<RankedEntryRow>`WITH ranked AS (${ranked}) SELECT * FROM ranked WHERE site_key = ${siteKey}`;
        return Option.map(Option.fromNullishOr(rows[0]), toBoardEntry);
      }, Effect.orDie);

      const getBySiteKey = Effect.fn("Board.getBySiteKey")(function* (siteKey: string) {
        const entry = yield* findBySiteKey(siteKey);
        if (Option.isNone(entry)) {
          return yield* new NotFound({ what: "entry", message: `Jev hasn't judged ${siteKey} yet.` });
        }
        return entry.value;
      });

      const getById = Effect.fn("Board.getById")(function* (id: string) {
        const rows = yield* sql<RankedEntryRow>`WITH ranked AS (${ranked}) SELECT * FROM ranked WHERE id = ${id}`.pipe(
          Effect.orDie,
        );
        const row = rows[0];
        if (!row) return yield* new NotFound({ what: "entry", message: "No such entry on the board." });
        return toBoardEntry(row);
      });

      const page = Effect.fn("Board.page")(function* (options: BoardQuery) {
        const pageSize = Math.max(1, Math.min(options.pageSize, 200));
        const pageNumber = Math.max(1, Math.floor(options.page));
        const offset = (pageNumber - 1) * pageSize;
        const query = options.query?.trim().toLowerCase().slice(0, 100) ?? "";
        const sort = options.sort ?? "rank";
        const now = Date.now();
        const clauses: Array<Statement.Fragment> = [];
        if (query.length > 0) {
          const like = `%${query.replace(/[%_]/g, "")}%`;
          clauses.push(sql`(lower(site_key) LIKE ${like} OR lower(name) LIKE ${like} OR lower(category) LIKE ${like})`);
        }
        if (options.category) clauses.push(sql`category = ${options.category}`);
        if (sort === "today") clauses.push(sql`last_judged_at >= ${now - 24 * 3600 * 1000}`);
        if (sort === "week") clauses.push(sql`last_judged_at >= ${now - 7 * 24 * 3600 * 1000}`);
        const filter = clauses.length > 0 ? sql`WHERE ${sql.and(clauses)}` : sql``;
        const orderBy =
          sort === "newest"
            ? sql`ORDER BY last_judged_at DESC`
            : sort === "rerolled"
              ? sql`ORDER BY rolls DESC, rank ASC`
              : sql`ORDER BY rank ASC`;
        const rows = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked})
          SELECT * FROM ranked ${filter}
          ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`;
        const counts = yield* sql<{ total: number }>`
          WITH ranked AS (${ranked}) SELECT COUNT(*) AS total FROM ranked ${filter}`;
        return {
          entries: rows.map(toBoardEntry),
          total: counts[0]?.total ?? 0,
          page: pageNumber,
          pageSize,
        } satisfies BoardPage;
      }, Effect.orDie);

      const top = Effect.fn("Board.top")(function* (limit: number) {
        const rows = yield* sql<RankedEntryRow>`WITH ranked AS (${ranked}) SELECT * FROM ranked ORDER BY rank LIMIT ${limit}`;
        return rows.map(toBoardEntry);
      }, Effect.orDie);

      const recent = Effect.fn("Board.recent")(function* (limit: number) {
        const rows = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked}) SELECT * FROM ranked ORDER BY last_judged_at DESC LIMIT ${limit}`;
        return rows.map(toBoardEntry);
      }, Effect.orDie);

      const contenderFor = (entry: EntryRow, judgment: JudgmentRow | undefined): DuelContender => ({
        siteKey: entry.siteKey,
        name: entry.name,
        label: entry.label,
        tldr: entry.tldr,
        category: entry.category,
        reasoning: judgment?.reasoning ?? entry.verdict,
        strengths: judgment ? parseList(judgment.strengths) : [],
        weaknesses: judgment ? parseList(judgment.weaknesses) : [],
      });

      const tiedGroup = Effect.fn("Board.tiedGroup")(function* (score: number, excludeSiteKey: string) {
        const rows = yield* sql<EntryRow>`
          SELECT * FROM entries
          WHERE score = ${score} AND hidden = 0 AND site_key != ${excludeSiteKey}
          ORDER BY tie_rank ASC, first_judged_at ASC`;
        if (rows.length === 0) return [];
        const judgments = yield* sql<JudgmentRow>`
          SELECT * FROM judgments WHERE id IN ${sql.in(rows.map((row) => row.judgmentId))}`;
        const byId = new Map(judgments.map((judgment) => [judgment.id, judgment]));
        return rows.map(
          (row): TiedEntry => ({
            id: row.id as EntryId,
            siteKey: row.siteKey,
            contender: contenderFor(row, byId.get(row.judgmentId)),
          }),
        );
      }, Effect.orDie);

      const kingId = sql<{ id: string }>`
        SELECT id FROM entries WHERE hidden = 0 ORDER BY score DESC, tie_rank ASC, first_judged_at ASC LIMIT 1`.pipe(
        Effect.map((rows) => rows[0]?.id ?? null),
      );

      const rankOf = (id: string) =>
        sql<{ rank: number }>`WITH ranked AS (${ranked}) SELECT rank FROM ranked WHERE id = ${id}`.pipe(
          Effect.map((rows) => rows[0]?.rank ?? null),
        );

      const insertEvent = (event: {
        readonly kind: EventKind;
        readonly entryId: string | null;
        readonly siteKey: string | null;
        readonly otherSiteKey?: string | null;
        readonly score?: number | null;
        readonly rank?: number | null;
        readonly delta?: number | null;
        readonly message: string;
        readonly createdAt: number;
      }) =>
        sql`INSERT INTO events ${sql.insert({
          kind: event.kind,
          entryId: event.entryId,
          siteKey: event.siteKey,
          otherSiteKey: event.otherSiteKey ?? null,
          score: event.score ?? null,
          rank: event.rank ?? null,
          delta: event.delta ?? null,
          message: event.message,
          createdAt: event.createdAt,
        })}`;

      const commitPlacement = Effect.fn("Board.commitPlacement")(
        function* (input: CommitPlacementInput) {
          const now = Date.now();
          const { verdict } = input;
          const existing = (yield* sql<EntryRow>`SELECT * FROM entries WHERE site_key = ${input.siteKey}`)[0];
          const kingBefore = yield* kingId;
          const previousRank = existing ? yield* rankOf(existing.id) : null;

          const entryId = (existing?.id as EntryId | undefined) ?? makeEntryId();
          const judgmentId = makeJudgmentId();
          const roll = (existing?.rolls ?? 0) + 1;
          const previousScore = existing?.score ?? null;
          const delta = previousScore === null ? 0 : verdict.score - previousScore;
          const ogImage = input.snapshot.ogImage;
          const hidden = verdict.contentFlag !== "none";
          const subscores = JSON.stringify(verdict.subscores);

          if (existing) {
            yield* sql`
              UPDATE entries SET
                url = ${input.url}, host = ${input.host}, name = ${verdict.name}, tldr = ${verdict.tldr},
                verdict = ${verdict.verdict}, category = ${verdict.category}, label = ${verdict.label},
                subscores = ${subscores}, score = ${verdict.score},
                judgment_id = ${judgmentId}, rolls = ${roll},
                best_score = ${Math.max(existing.bestScore, verdict.score)},
                worst_score = ${Math.min(existing.worstScore, verdict.score)},
                last_delta = ${delta}, manipulation_attempt = ${verdict.manipulationAttempt ? 1 : 0},
                hidden = ${hidden ? 1 : 0}, content_flag = ${verdict.contentFlag},
                og_image = ${ogImage}, last_judged_at = ${now}
              WHERE id = ${entryId}`;
          } else {
            const [numbering] = yield* sql<{ next: number }>`SELECT COALESCE(MAX(entry_number), 0) + 1 AS next FROM entries`;
            yield* sql`INSERT INTO entries ${sql.insert({
              id: entryId,
              siteKey: input.siteKey,
              url: input.url,
              host: input.host,
              name: verdict.name,
              tldr: verdict.tldr,
              verdict: verdict.verdict,
              category: verdict.category,
              label: verdict.label,
              subscores,
              score: verdict.score,
              tieRank: 0,
              judgmentId,
              rolls: 1,
              bestScore: verdict.score,
              worstScore: verdict.score,
              lastDelta: 0,
              manipulationAttempt: verdict.manipulationAttempt ? 1 : 0,
              hidden: hidden ? 1 : 0,
              contentFlag: verdict.contentFlag,
              ogImage,
              entryNumber: numbering?.next ?? 1,
              clicks: 0,
              firstJudgedAt: now,
              lastJudgedAt: now,
            })}`;
          }

          // Jev's tiebreak order becomes the tie_rank of the whole group.
          if (!hidden) {
            const tieOrder = input.tieOrder.map((id) => id ?? entryId);
            for (const [index, id] of tieOrder.entries()) {
              yield* sql`UPDATE entries SET tie_rank = ${index} WHERE id = ${id}`;
            }
          }

          const rank = hidden ? 0 : ((yield* rankOf(entryId)) ?? 1);
          const [serial] = yield* sql<{ next: number }>`SELECT COALESCE(MAX(serial), 0) + 1 AS next FROM judgments`;

          yield* sql`INSERT INTO judgments ${sql.insert({
            id: judgmentId,
            serial: serial?.next ?? 1,
            entryId,
            orderId: input.orderId,
            roll,
            score: verdict.score,
            previousScore,
            rankAtPlacement: rank,
            name: verdict.name,
            tldr: verdict.tldr,
            verdict: verdict.verdict,
            reasoning: verdict.reasoning,
            category: verdict.category,
            label: verdict.label,
            subscores,
            strengths: JSON.stringify(verdict.strengths),
            weaknesses: JSON.stringify(verdict.weaknesses),
            receipts: JSON.stringify(verdict.receipts),
            manipulationAttempt: verdict.manipulationAttempt ? 1 : 0,
            contentFlag: verdict.contentFlag,
            pagesCrawled: JSON.stringify(input.pagesCrawled),
            model: input.model,
            createdAt: now,
          })}`;

          for (const duel of input.duels) {
            yield* sql`INSERT INTO duels ${sql.insert({
              id: `d${randomId(14)}`,
              judgmentId,
              challengerId: entryId,
              opponentId: duel.opponentId,
              winnerId: duel.challengerWon ? entryId : duel.opponentId,
              reason: duel.reason,
              score: verdict.score,
              createdAt: now,
            })}`;
          }

          if (hidden) {
            // Declined sites never reach the tape; a king that got flagged loses the crown quietly.
            const kingAfterHidden = yield* kingId;
            if (kingBefore === entryId && kingAfterHidden !== entryId) {
              yield* sql`UPDATE reigns SET ended_at = ${now} WHERE entry_id = ${entryId} AND ended_at IS NULL`;
              if (kingAfterHidden !== null) {
                yield* sql`INSERT INTO reigns ${sql.insert({ entryId: kingAfterHidden, startedAt: now, endedAt: null })}`;
              }
            }
            return {
              entryId,
              judgmentId,
              siteKey: input.siteKey,
              roll,
              score: verdict.score,
              previousScore,
              rank: 0,
              previousRank,
              crowned: false,
              hidden: true,
            } satisfies PlacementResult;
          }

          // Ticker events
          if (previousScore === null) {
            yield* insertEvent({
              kind: "placed",
              entryId,
              siteKey: input.siteKey,
              score: verdict.score,
              rank,
              message: `🆕 ${input.siteKey} entered the board at #${rank} with ${verdict.score}/1000`,
              createdAt: now,
            });
          } else {
            yield* insertEvent({
              kind: "rerolled",
              entryId,
              siteKey: input.siteKey,
              score: verdict.score,
              rank,
              delta,
              message: `🎲 ${input.siteKey} rerolled: ${previousScore} → ${verdict.score} (${signed(delta)}), now #${rank}`,
              createdAt: now,
            });
          }

          if (input.duels.length > 0) {
            const wins = input.duels.filter((duel) => duel.challengerWon).length;
            const last = input.duels[input.duels.length - 1]!;
            yield* insertEvent({
              kind: "duel",
              entryId,
              siteKey: input.siteKey,
              otherSiteKey: last.opponentSiteKey,
              score: verdict.score,
              rank,
              message: `⚔️ ${input.siteKey} tied at ${verdict.score} and fought ${input.duels.length} tiebreak duel${input.duels.length === 1 ? "" : "s"} (${wins}W ${input.duels.length - wins}L)`,
              createdAt: now,
            });
          }

          if (verdict.manipulationAttempt) {
            yield* insertEvent({
              kind: "bribe",
              entryId,
              siteKey: input.siteKey,
              score: verdict.score,
              message: `🚨 ${input.siteKey} tried to sweet-talk Jev. Jev noticed.`,
              createdAt: now,
            });
          }

          // Changes at the top of the board
          const kingAfter = yield* kingId;
          const crowned = kingAfter === entryId && kingBefore !== entryId;
          if (kingAfter !== kingBefore) {
            if (kingBefore !== null) {
              yield* sql`UPDATE reigns SET ended_at = ${now} WHERE entry_id = ${kingBefore} AND ended_at IS NULL`;
              const fallen = (yield* sql<{ siteKey: string }>`SELECT site_key FROM entries WHERE id = ${kingBefore}`)[0];
              if (fallen) {
                const usurper =
                  kingAfter === entryId
                    ? input.siteKey
                    : ((yield* sql<{ siteKey: string }>`SELECT site_key FROM entries WHERE id = ${kingAfter}`)[0]?.siteKey ?? "someone");
                yield* insertEvent({
                  kind: "dethroned",
                  entryId: kingBefore,
                  siteKey: fallen.siteKey,
                  otherSiteKey: usurper,
                  message:
                    kingBefore === entryId
                      ? `💀 ${fallen.siteKey} rerolled itself off the throne. ${usurper} inherits the crown.`
                      : `💀 ${fallen.siteKey} was dethroned by ${usurper}`,
                  createdAt: now,
                });
              }
            }
            if (kingAfter !== null) {
              yield* sql`INSERT INTO reigns ${sql.insert({ entryId: kingAfter, startedAt: now, endedAt: null })}`;
              const king = (yield* sql<{ siteKey: string; score: number }>`
                SELECT site_key, score FROM entries WHERE id = ${kingAfter}`)[0];
              if (king) {
                yield* insertEvent({
                  kind: "crowned",
                  entryId: kingAfter,
                  siteKey: king.siteKey,
                  score: king.score,
                  rank: 1,
                  message: `👑 ${king.siteKey} is the new #1 with ${king.score}/1000`,
                  createdAt: now,
                });
              }
            }
          }

          return {
            entryId,
            judgmentId,
            siteKey: input.siteKey,
            roll,
            score: verdict.score,
            previousScore,
            rank,
            previousRank,
            crowned,
            hidden: false,
          } satisfies PlacementResult;
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const judgments = Effect.fn("Board.judgments")(function* (entryId: EntryId) {
        const rows = yield* sql<JudgmentRow>`SELECT * FROM judgments WHERE entry_id = ${entryId} ORDER BY roll DESC`;
        return rows.map(toJudgment);
      }, Effect.orDie);

      const judgment = Effect.fn("Board.judgment")(function* (id: string) {
        const rows = yield* sql<JudgmentRow>`SELECT * FROM judgments WHERE id = ${id}`;
        return Option.map(Option.fromNullishOr(rows[0]), toJudgment);
      }, Effect.orDie);

      interface DuelRow {
        readonly id: string;
        readonly judgmentId: string;
        readonly challengerId: string;
        readonly challengerSiteKey: string;
        readonly opponentId: string;
        readonly opponentSiteKey: string;
        readonly winnerId: string;
        readonly reason: string;
        readonly score: number;
        readonly createdAt: number;
      }
      const toDuel = (row: DuelRow): Duel => ({
        ...row,
        judgmentId: row.judgmentId as JudgmentId,
        challengerId: row.challengerId as EntryId,
        opponentId: row.opponentId as EntryId,
        winnerId: row.winnerId as EntryId,
      });
      const duelSelect = sql`
        SELECT d.*, c.site_key AS challenger_site_key, o.site_key AS opponent_site_key
        FROM duels d
        JOIN entries c ON c.id = d.challenger_id
        JOIN entries o ON o.id = d.opponent_id`;

      const duelsForEntry = Effect.fn("Board.duelsForEntry")(function* (entryId: EntryId, limit: number) {
        const rows = yield* sql<DuelRow>`
          ${duelSelect}
          WHERE d.challenger_id = ${entryId} OR d.opponent_id = ${entryId}
          ORDER BY d.created_at DESC LIMIT ${limit}`;
        return rows.map(toDuel);
      }, Effect.orDie);

      const duelsForJudgment = Effect.fn("Board.duelsForJudgment")(function* (judgmentId: string) {
        const rows = yield* sql<DuelRow>`${duelSelect} WHERE d.judgment_id = ${judgmentId} ORDER BY d.rowid ASC`;
        return rows.map(toDuel);
      }, Effect.orDie);

      const events = Effect.fn("Board.events")(function* (options: {
        readonly afterId?: number | undefined;
        readonly limit: number;
      }) {
        const rows = yield* options.afterId !== undefined
          ? sql<BoardEvent>`SELECT * FROM events WHERE id > ${options.afterId} ORDER BY id DESC LIMIT ${options.limit}`
          : sql<BoardEvent>`SELECT * FROM events ORDER BY id DESC LIMIT ${options.limit}`;
        return rows.map((row) => ({ ...row, entryId: row.entryId as EntryId | null }));
      }, Effect.orDie);

      const stats = Effect.gen(function* () {
        const [entryStats] = yield* sql<{
          entries: number;
          averageScore: number | null;
          highestScore: number | null;
          lowestScore: number | null;
        }>`SELECT COUNT(*) AS entries, AVG(score) AS average_score, MAX(score) AS highest_score, MIN(score) AS lowest_score FROM entries WHERE hidden = 0`;
        const [judgmentStats] = yield* sql<{ judgments: number; rerolls: number | null; bribes: number | null }>`
          SELECT COUNT(*) AS judgments,
                 SUM(CASE WHEN roll > 1 THEN 1 ELSE 0 END) AS rerolls,
                 SUM(manipulation_attempt) AS bribes
          FROM judgments`;
        const [money] = yield* sql<{ revenueCents: number | null }>`
          SELECT SUM(amount_cents) AS revenue_cents FROM orders WHERE paid_at IS NOT NULL`;
        const [duelStats] = yield* sql<{ duels: number }>`SELECT COUNT(*) AS duels FROM duels`;
        const buckets = yield* sql<{ bucket: number; count: number }>`
          SELECT (score - 1) / 100 AS bucket, COUNT(*) AS count FROM entries WHERE hidden = 0 GROUP BY bucket`;
        const histogram = Array.from({ length: 10 }, (_, index) => buckets.find((b) => b.bucket === index)?.count ?? 0);
        const [king] = yield* sql<{ siteKey: string; name: string; score: number; since: number | null }>`
          SELECT e.site_key, e.name, e.score,
                 (SELECT r.started_at FROM reigns r WHERE r.entry_id = e.id AND r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1) AS since
          FROM entries e WHERE e.hidden = 0 ORDER BY e.score DESC, e.tie_rank ASC, e.first_judged_at ASC LIMIT 1`;
        const [live] = yield* sql<{ judgingNow: number }>`
          SELECT COUNT(*) AS judging_now FROM orders WHERE status IN ${sql.in(IN_FLIGHT_STATUSES)}`;
        const [visitorStats] = yield* sql<{ visitors: number }>`SELECT COUNT(*) AS visitors FROM visitors`;
        const [clickStats] = yield* sql<{ clicks: number | null }>`SELECT SUM(clicks) AS clicks FROM entries`;
        const [launch] = yield* sql<{ launchedAt: number | null }>`
          SELECT MIN(paid_at) AS launched_at FROM orders WHERE paid_at IS NOT NULL`;
        return {
          entries: entryStats?.entries ?? 0,
          judgments: judgmentStats?.judgments ?? 0,
          rerolls: judgmentStats?.rerolls ?? 0,
          revenueCents: money?.revenueCents ?? 0,
          averageScore: entryStats?.averageScore === null || entryStats?.averageScore === undefined ? null : Math.round(entryStats.averageScore),
          highestScore: entryStats?.highestScore ?? null,
          lowestScore: entryStats?.lowestScore ?? null,
          duels: duelStats?.duels ?? 0,
          bribesCaught: judgmentStats?.bribes ?? 0,
          histogram,
          judgingNow: live?.judgingNow ?? 0,
          visitors: visitorStats?.visitors ?? 0,
          clicksSent: clickStats?.clicks ?? 0,
          launchedAt: launch?.launchedAt ?? null,
          king: king ? { siteKey: king.siteKey, name: king.name, score: king.score, since: king.since ?? Date.now() } : null,
        } satisfies BoardStats;
      }).pipe(Effect.orDie, Effect.withSpan("Board.stats"));

      const hall = Effect.gen(function* () {
        const now = Date.now();
        const reignRows = yield* sql<{
          entryId: string;
          siteKey: string;
          name: string;
          startedAt: number;
          endedAt: number | null;
        }>`
          SELECT r.entry_id, e.site_key, e.name, r.started_at, r.ended_at
          FROM reigns r JOIN entries e ON e.id = r.entry_id
          WHERE e.hidden = 0
          ORDER BY (COALESCE(r.ended_at, ${now}) - r.started_at) DESC LIMIT 10`;
        const reigns = reignRows.map(
          (row): Reign => ({
            ...row,
            entryId: row.entryId as EntryId,
            durationMs: (row.endedAt ?? now) - row.startedAt,
          }),
        );
        const mostRerolled = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked}) SELECT * FROM ranked WHERE rolls > 1 ORDER BY rolls DESC, rank ASC LIMIT 10`;
        const lowest = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked}) SELECT * FROM ranked ORDER BY rank DESC LIMIT 10`;
        const bribers = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked}) SELECT * FROM ranked WHERE manipulation_attempt = 1 ORDER BY last_judged_at DESC LIMIT 10`;
        const jumps = yield* sql<JudgmentRow & { siteKey: string }>`
          SELECT j.*, e.site_key FROM judgments j JOIN entries e ON e.id = j.entry_id
          WHERE e.hidden = 0 AND j.previous_score IS NOT NULL AND j.score > j.previous_score
          ORDER BY (j.score - j.previous_score) DESC LIMIT 10`;
        const drops = yield* sql<JudgmentRow & { siteKey: string }>`
          SELECT j.*, e.site_key FROM judgments j JOIN entries e ON e.id = j.entry_id
          WHERE e.hidden = 0 AND j.previous_score IS NOT NULL AND j.score < j.previous_score
          ORDER BY (j.score - j.previous_score) ASC LIMIT 10`;
        const champions = yield* sql<{ siteKey: string; name: string; wins: number; losses: number }>`
          SELECT e.site_key, e.name,
            SUM(CASE WHEN d.winner_id = e.id THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN d.winner_id != e.id THEN 1 ELSE 0 END) AS losses
          FROM entries e JOIN duels d ON d.challenger_id = e.id OR d.opponent_id = e.id
          WHERE e.hidden = 0
          GROUP BY e.id ORDER BY wins DESC, losses ASC LIMIT 10`;
        return {
          reigns,
          mostRerolled: mostRerolled.map(toBoardEntry),
          lowest: lowest.map(toBoardEntry),
          bribers: bribers.map(toBoardEntry),
          biggestJumps: jumps.map((row) => ({ ...toJudgment(row), siteKey: row.siteKey })),
          biggestDrops: drops.map((row) => ({ ...toJudgment(row), siteKey: row.siteKey })),
          duelChampions: champions,
        } satisfies Hall;
      }).pipe(Effect.orDie, Effect.withSpan("Board.hall"));

      const neighbours = Effect.fn("Board.neighbours")(function* (entryId: EntryId, radius: number) {
        const rank = yield* rankOf(entryId);
        if (rank === null) return [];
        const rows = yield* sql<RankedEntryRow>`
          WITH ranked AS (${ranked})
          SELECT * FROM ranked WHERE rank BETWEEN ${rank - radius} AND ${rank + radius} ORDER BY rank`;
        return rows.map(toBoardEntry);
      }, Effect.orDie);

      const recordClick = Effect.fn("Board.recordClick")(function* (siteKey: string) {
        const rows = yield* sql<{ url: string }>`
          UPDATE entries SET clicks = clicks + 1 WHERE site_key = ${siteKey} AND hidden = 0 RETURNING url`;
        return Option.map(Option.fromNullishOr(rows[0]), (row) => row.url);
      }, Effect.orDie);

      const recordVisitor = Effect.fn("Board.recordVisitor")(function* (visitorId: string) {
        yield* sql`INSERT OR IGNORE INTO visitors (id, first_seen_at) VALUES (${visitorId}, ${Date.now()})`;
      }, Effect.orDie);

      const categories = sql<{ category: string; count: number }>`
        SELECT category, COUNT(*) AS count FROM entries WHERE hidden = 0 GROUP BY category ORDER BY count DESC`.pipe(
        Effect.orDie,
        Effect.withSpan("Board.categories"),
      );

      const daily = Effect.fn("Board.daily")(function* (days: number) {
        const since = Date.now() - days * 24 * 3600 * 1000;
        const judged = yield* sql<{ day: string; judgments: number; rerolls: number }>`
          SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
                 COUNT(*) AS judgments,
                 SUM(CASE WHEN roll > 1 THEN 1 ELSE 0 END) AS rerolls
          FROM judgments WHERE created_at >= ${since} GROUP BY day`;
        const paid = yield* sql<{ day: string; revenueCents: number }>`
          SELECT strftime('%Y-%m-%d', paid_at / 1000, 'unixepoch') AS day, SUM(amount_cents) AS revenue_cents
          FROM orders WHERE paid_at IS NOT NULL AND paid_at >= ${since} GROUP BY day`;
        const out: Array<DailyStat> = [];
        for (let i = days - 1; i >= 0; i--) {
          const day = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const j = judged.find((row) => row.day === day);
          const p = paid.find((row) => row.day === day);
          out.push({ day, judgments: j?.judgments ?? 0, rerolls: j?.rerolls ?? 0, revenueCents: p?.revenueCents ?? 0 });
        }
        return out;
      }, Effect.orDie);

      return Board.of({
        daily,
        recordClick,
        recordVisitor,
        categories,
        findBySiteKey,
        getBySiteKey,
        getById,
        page,
        top,
        recent,
        tiedGroup,
        commitPlacement,
        judgments,
        judgment,
        duelsForEntry,
        duelsForJudgment,
        events,
        stats,
        hall,
        neighbours,
      });
    }),
  );
}
