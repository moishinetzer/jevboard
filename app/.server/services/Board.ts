import { Context, Effect, Layer, Option } from "effect";
import { SqlClient, type Statement } from "effect/sql";
import { iconPath } from "~/lib/site-key";
import { SqlBatch } from "../db/SqlBatch";
import { NotFound } from "../domain/errors";
import { type EntryId, type JudgmentId, makeEntryId, makeJudgmentId, type OrderId, randomId } from "../domain/ids";
import {
  type BoardEntry,
  type BoardEvent,
  type BoardStats,
  type ContentFlag,
  type DuelContender,
  type EventKind,
  IN_FLIGHT_STATUSES,
  type Judgment,
  type SiteProfile,
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
  readonly siteTitle: string | null;
  readonly siteDescription: string | null;
  readonly iconUrl: string | null;
  readonly iconVersion: number | null;
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
  subscores: parseSubScores(row.subscores),
  ogImage: row.ogImage,
  siteTitle: row.siteTitle || null,
  siteDescription: row.siteDescription || null,
  // Our own copy of the logo (see Icons), never the address on the business's server.
  iconUrl: row.iconVersion ? iconPath(row.siteKey, row.iconVersion) : null,
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
  /** og:image found while crawling, shown on the verdict page. */
  readonly ogImage: string | null;
  /** The homepage's own title, description and icon, shown on its board row (null: keep what we have). */
  readonly site: SiteProfile | null;
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
    readonly page: (options: BoardQuery) => Effect.Effect<BoardPage>;
    readonly top: (limit: number) => Effect.Effect<ReadonlyArray<BoardEntry>>;
    /** Visible entries currently at `score`, best first, excluding the site being placed. */
    readonly tiedGroup: (score: number, excludeSiteKey: string) => Effect.Effect<ReadonlyArray<TiedEntry>>;
    /** The judgment already written for an order, if any (placement idempotency). */
    readonly judgmentForOrder: (orderId: string) => Effect.Effect<Option.Option<{ readonly id: JudgmentId; readonly entryId: EntryId }>>;
    /** Rolls so far for a site, counting entries hidden by a content flag. */
    readonly rollsFor: (siteKey: string) => Effect.Effect<number>;
    /** Every visible verdict page, for the sitemap. */
    readonly sitemap: Effect.Effect<ReadonlyArray<{ readonly siteKey: string; readonly lastJudgedAt: number }>>;
    /** Atomically writes a finished judgment, its placement and the order's completion. */
    readonly commitPlacement: (input: CommitPlacementInput) => Effect.Effect<PlacementResult>;
    readonly judgments: (entryId: EntryId) => Effect.Effect<ReadonlyArray<Judgment>>;
    /** Visible entries whose homepage profile was never read (placed before profiles existed), oldest first. */
    readonly withoutSiteProfile: (limit: number) => Effect.Effect<ReadonlyArray<{ readonly id: EntryId; readonly url: string }>>;
    /** Stores what a business's homepage says about it (null: it couldn't be read; don't try again). */
    readonly setSiteProfile: (id: EntryId, profile: SiteProfile | null) => Effect.Effect<void>;
    /** Visible entries whose icon was never copied (see Icons), oldest first, with the address the crawl found. */
    readonly withoutIcon: (
      limit: number,
    ) => Effect.Effect<ReadonlyArray<{ readonly id: EntryId; readonly siteKey: string; readonly iconUrl: string | null }>>;
    /** Records the copy's version for an entry (0: it has no usable icon; don't try again). */
    readonly setIconVersion: (id: EntryId, version: number) => Effect.Effect<void>;
    /** Jev's reasoning behind each entry's current verdict, by entry id (at most 100 ids). */
    readonly reasoning: (entryIds: ReadonlyArray<EntryId>) => Effect.Effect<ReadonlyMap<EntryId, string>>;
    readonly judgment: (id: string) => Effect.Effect<Option.Option<Judgment>>;
    readonly events: (options: { readonly afterId?: number | undefined; readonly limit: number }) => Effect.Effect<ReadonlyArray<BoardEvent>>;
    readonly stats: Effect.Effect<BoardStats>;
    /** Counts an outbound visit and returns the URL to redirect to. */
    readonly recordClick: (siteKey: string) => Effect.Effect<Option.Option<string>>;
  }
>()("jevboard/Board") {
  static readonly layer = Layer.effect(
    Board,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const batch = yield* SqlBatch;

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

      const page = Effect.fn("Board.page")(function* (options: BoardQuery) {
        const pageSize = Math.max(1, Math.min(options.pageSize, 200));
        const pageNumber = Math.max(1, Math.floor(options.page));
        const offset = (pageNumber - 1) * pageSize;
        const query = options.query?.trim().toLowerCase().slice(0, 100) ?? "";
        const sort = options.sort ?? "rank";
        const now = Date.now();
        const clauses: Array<Statement.Fragment> = [];
        if (query.length > 0) {
          // instr() rather than LIKE: D1 caps LIKE patterns at 50 bytes.
          clauses.push(
            sql`(instr(lower(site_key), ${query}) > 0 OR instr(lower(name), ${query}) > 0 OR instr(lower(category), ${query}) > 0)`,
          );
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

      const contenderFor = (entry: EntryRow, judgment: JudgmentRow | undefined): DuelContender => ({
        siteKey: entry.siteKey,
        name: entry.name,
        tldr: entry.tldr,
        category: entry.category,
        reasoning: judgment?.reasoning ?? entry.verdict,
        strengths: judgment ? parseList(judgment.strengths) : [],
        weaknesses: judgment ? parseList(judgment.weaknesses) : [],
      });

      const tiedGroup = Effect.fn("Board.tiedGroup")(function* (score: number, excludeSiteKey: string) {
        // One JOIN (not an IN list): D1 allows at most 100 bound parameters.
        const rows = yield* sql<EntryRow & { jReasoning: string | null; jStrengths: string | null; jWeaknesses: string | null }>`
          SELECT e.*, j.reasoning AS j_reasoning, j.strengths AS j_strengths, j.weaknesses AS j_weaknesses
          FROM entries e LEFT JOIN judgments j ON j.id = e.judgment_id
          WHERE e.score = ${score} AND e.hidden = 0 AND e.site_key != ${excludeSiteKey}
          ORDER BY e.tie_rank ASC, e.first_judged_at ASC`;
        return rows.map(
          (row): TiedEntry => ({
            id: row.id as EntryId,
            siteKey: row.siteKey,
            contender: {
              siteKey: row.siteKey,
              name: row.name,
              tldr: row.tldr,
              category: row.category,
              reasoning: row.jReasoning ?? row.verdict,
              strengths: row.jStrengths ? parseList(row.jStrengths) : [],
              weaknesses: row.jWeaknesses ? parseList(row.jWeaknesses) : [],
            },
          }),
        );
      }, Effect.orDie);

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

      /**
       * Writes a finished judgment and its placement.
       *
       * D1 has no interactive transactions, so this reads everything it needs
       * first, derives the new rank and throne holder, and then commits every
       * write in one atomic batch. That's only correct because placements are
       * serialized (the placement queue runs one job at a time), which the tie
       * group ordering requires anyway.
       */
      const commitPlacement = Effect.fn("Board.commitPlacement")(
        function* (input: CommitPlacementInput) {
          const now = Date.now();
          const { verdict } = input;
          const S = verdict.score;
          const hidden = verdict.contentFlag !== "none";

          // ---- Read phase -------------------------------------------------
          const existing = (yield* sql<EntryRow>`SELECT * FROM entries WHERE site_key = ${input.siteKey}`)[0];
          const kingBeforeRow = (yield* sql<{ id: string; siteKey: string }>`
            SELECT id, site_key FROM entries WHERE hidden = 0
            ORDER BY score DESC, tie_rank ASC, first_judged_at ASC LIMIT 1`)[0];
          const kingBefore = kingBeforeRow?.id ?? null;
          // The judging stage copied the site's icon (Icons); the row points at that copy.
          const iconVersion =
            (yield* sql<{ createdAt: number }>`SELECT created_at FROM site_icons WHERE site_key = ${input.siteKey}`)[0]?.createdAt ?? null;
          const previousRank = existing && existing.hidden === 0 ? yield* rankOf(existing.id) : null;
          const [numbers] = yield* sql<{ nextEntry: number; nextSerial: number }>`
            SELECT (SELECT COALESCE(MAX(entry_number), 0) + 1 FROM entries) AS next_entry,
                   (SELECT COALESCE(MAX(serial), 0) + 1 FROM judgments) AS next_serial`;
          const [above] = yield* sql<{ count: number }>`
            SELECT COUNT(*) AS count FROM entries WHERE hidden = 0 AND site_key != ${input.siteKey} AND score > ${S}`;
          // Best visible entry other than this one (its tie rank may be about to change).
          const topOther = (yield* sql<{ id: string; siteKey: string; score: number }>`
            SELECT id, site_key, score FROM entries WHERE hidden = 0 AND site_key != ${input.siteKey}
            ORDER BY score DESC, tie_rank ASC, first_judged_at ASC LIMIT 1`)[0];

          const entryId = (existing?.id as EntryId | undefined) ?? makeEntryId();
          const judgmentId = makeJudgmentId();
          const roll = (existing?.rolls ?? 0) + 1;
          const previousScore = existing?.score ?? null;
          const delta = previousScore === null ? 0 : S - previousScore;
          const subscores = JSON.stringify(verdict.subscores);
          const tieOrder = input.tieOrder.map((id) => id ?? entryId);
          const position = Math.max(0, tieOrder.indexOf(entryId));

          // New rank and new #1, derived exactly from the reads above.
          const rank = hidden ? 0 : (above?.count ?? 0) + position + 1;
          let kingAfter: { id: string; siteKey: string } | null;
          if (!hidden && rank === 1) kingAfter = { id: entryId, siteKey: input.siteKey };
          else if (!topOther) kingAfter = null;
          else if (!hidden && topOther.score === S) {
            // The top group is the one we just re-ordered: its new head is the king.
            const headId = tieOrder[0]!;
            const headSiteKey = headId === topOther.id ? topOther.siteKey : (yield* sql<{ siteKey: string }>`
              SELECT site_key FROM entries WHERE id = ${headId}`)[0]?.siteKey ?? topOther.siteKey;
            kingAfter = { id: headId, siteKey: headSiteKey };
          } else kingAfter = { id: topOther.id, siteKey: topOther.siteKey };
          const crowned = kingAfter?.id === entryId && kingBefore !== entryId;

          // ---- Write phase: one atomic batch ------------------------------
          const writes: Array<Statement.Statement<unknown>> = [];

          if (existing) {
            writes.push(sql`
              UPDATE entries SET
                url = ${input.url}, host = ${input.host}, name = ${verdict.name}, tldr = ${verdict.tldr},
                verdict = ${verdict.verdict}, category = ${verdict.category},
                subscores = ${subscores}, score = ${S},
                judgment_id = ${judgmentId}, rolls = ${roll},
                best_score = ${Math.max(existing.bestScore, S)},
                worst_score = ${Math.min(existing.worstScore, S)},
                last_delta = ${delta}, manipulation_attempt = ${verdict.manipulationAttempt ? 1 : 0},
                hidden = ${hidden ? 1 : 0}, content_flag = ${verdict.contentFlag},
                og_image = ${input.ogImage}, last_judged_at = ${now},
                site_title = COALESCE(${input.site?.title || null}, site_title),
                site_description = COALESCE(${input.site?.description || null}, site_description),
                icon_url = CASE WHEN ${input.site ? 1 : 0} = 1 THEN ${input.site?.icon ?? null} ELSE icon_url END,
                icon_version = COALESCE(${iconVersion}, icon_version),
                site_checked_at = CASE WHEN ${input.site ? 1 : 0} = 1 THEN ${now} ELSE site_checked_at END
              WHERE id = ${entryId}`);
          } else {
            writes.push(sql`INSERT INTO entries ${sql.insert({
              id: entryId,
              siteKey: input.siteKey,
              url: input.url,
              host: input.host,
              name: verdict.name,
              tldr: verdict.tldr,
              verdict: verdict.verdict,
              category: verdict.category,
              subscores,
              score: S,
              tieRank: 0,
              judgmentId,
              rolls: 1,
              bestScore: S,
              worstScore: S,
              lastDelta: 0,
              manipulationAttempt: verdict.manipulationAttempt ? 1 : 0,
              hidden: hidden ? 1 : 0,
              contentFlag: verdict.contentFlag,
              ogImage: input.ogImage,
              siteTitle: input.site?.title || null,
              siteDescription: input.site?.description || null,
              iconUrl: input.site?.icon ?? null,
              iconVersion,
              siteCheckedAt: input.site ? now : null,
              entryNumber: numbers?.nextEntry ?? 1,
              clicks: 0,
              firstJudgedAt: now,
              lastJudgedAt: now,
            })}`);
          }

          // Jev's tiebreak order becomes the tie_rank of the whole group.
          if (!hidden) {
            for (const [index, id] of tieOrder.entries()) {
              writes.push(sql`UPDATE entries SET tie_rank = ${index} WHERE id = ${id}`);
            }
          }

          writes.push(sql`INSERT INTO judgments ${sql.insert({
            id: judgmentId,
            serial: numbers?.nextSerial ?? 1,
            entryId,
            orderId: input.orderId,
            roll,
            score: S,
            previousScore,
            rankAtPlacement: rank,
            name: verdict.name,
            tldr: verdict.tldr,
            verdict: verdict.verdict,
            reasoning: verdict.reasoning,
            category: verdict.category,
            subscores,
            strengths: JSON.stringify(verdict.strengths),
            weaknesses: JSON.stringify(verdict.weaknesses),
            receipts: JSON.stringify(verdict.receipts),
            manipulationAttempt: verdict.manipulationAttempt ? 1 : 0,
            contentFlag: verdict.contentFlag,
            pagesCrawled: JSON.stringify(input.pagesCrawled),
            model: input.model,
            createdAt: now,
          })}`);

          for (const [seq, duel] of input.duels.entries()) {
            writes.push(sql`INSERT INTO duels ${sql.insert({
              id: `d${randomId(14)}`,
              judgmentId,
              challengerId: entryId,
              opponentId: duel.opponentId,
              winnerId: duel.challengerWon ? entryId : duel.opponentId,
              reason: duel.reason,
              score: S,
              seq,
              createdAt: now,
            })}`);
          }

          // Ticker events (declined sites never reach the tape).
          if (!hidden) {
            writes.push(
              previousScore === null
                ? insertEvent({
                    kind: "placed",
                    entryId,
                    siteKey: input.siteKey,
                    score: S,
                    rank,
                    message: `🆕 ${input.siteKey} entered the board at #${rank} with ${S}/1000`,
                    createdAt: now,
                  })
                : insertEvent({
                    kind: "rerolled",
                    entryId,
                    siteKey: input.siteKey,
                    score: S,
                    rank,
                    delta,
                    message: `🎲 ${input.siteKey} rerolled: ${previousScore} → ${S} (${signed(delta)}), now #${rank}`,
                    createdAt: now,
                  }),
            );
            if (input.duels.length > 0) {
              const wins = input.duels.filter((duel) => duel.challengerWon).length;
              const last = input.duels[input.duels.length - 1]!;
              writes.push(
                insertEvent({
                  kind: "duel",
                  entryId,
                  siteKey: input.siteKey,
                  otherSiteKey: last.opponentSiteKey,
                  score: S,
                  rank,
                  message: `⚔️ ${input.siteKey} tied at ${S} and fought ${input.duels.length} tiebreak duel${input.duels.length === 1 ? "" : "s"} (${wins}W ${input.duels.length - wins}L)`,
                  createdAt: now,
                }),
              );
            }
            if (verdict.manipulationAttempt) {
              writes.push(
                insertEvent({
                  kind: "bribe",
                  entryId,
                  siteKey: input.siteKey,
                  score: S,
                  message: `🚨 ${input.siteKey} tried to sweet-talk Jev. Jev noticed.`,
                  createdAt: now,
                }),
              );
            }
          }

          // Changes at the top of the board.
          if ((kingAfter?.id ?? null) !== kingBefore) {
            if (kingBeforeRow) {
              writes.push(sql`UPDATE reigns SET ended_at = ${now} WHERE entry_id = ${kingBeforeRow.id} AND ended_at IS NULL`);
              if (!hidden || kingBeforeRow.id !== entryId) {
                const usurper = kingAfter?.siteKey ?? "nobody";
                writes.push(
                  insertEvent({
                    kind: "dethroned",
                    entryId: kingBeforeRow.id,
                    siteKey: kingBeforeRow.siteKey,
                    otherSiteKey: usurper,
                    message:
                      kingBeforeRow.id === entryId
                        ? `💀 ${kingBeforeRow.siteKey} rerolled itself off the throne. ${usurper} inherits the crown.`
                        : `💀 ${kingBeforeRow.siteKey} was dethroned by ${usurper}`,
                    createdAt: now,
                  }),
                );
              }
            }
            if (kingAfter) {
              writes.push(sql`INSERT INTO reigns ${sql.insert({ entryId: kingAfter.id, startedAt: now, endedAt: null })}`);
              const kingScore = kingAfter.id === entryId ? S : (topOther?.score ?? S);
              writes.push(
                insertEvent({
                  kind: "crowned",
                  entryId: kingAfter.id,
                  siteKey: kingAfter.siteKey,
                  score: kingScore,
                  rank: 1,
                  message: `👑 ${kingAfter.siteKey} is the new #1 with ${kingScore}/1000`,
                  createdAt: now,
                }),
              );
            }
          }

          // The order completes in the same batch, so a crash can't leave a placed
          // judgment behind an unfinished order (judgments.order_id is UNIQUE too).
          writes.push(sql`
            UPDATE orders
            SET status = 'complete', stage_detail = 'Jev has spoken.', error = NULL, claim_token = NULL,
                entry_id = ${entryId}, judgment_id = ${judgmentId}, completed_at = ${now}, updated_at = ${now}
            WHERE id = ${input.orderId} AND status NOT IN ('complete', 'failed')`);

          yield* batch.run(writes);

          return {
            entryId,
            judgmentId,
            siteKey: input.siteKey,
            roll,
            score: S,
            previousScore,
            rank,
            previousRank,
            crowned,
            hidden,
          } satisfies PlacementResult;
        },
        Effect.orDie,
      );

      const judgmentForOrder = Effect.fn("Board.judgmentForOrder")(function* (orderId: string) {
        const rows = yield* sql<{ id: string; entryId: string }>`
          SELECT id, entry_id FROM judgments WHERE order_id = ${orderId} LIMIT 1`;
        return Option.map(Option.fromNullishOr(rows[0]), (row) => ({
          id: row.id as JudgmentId,
          entryId: row.entryId as EntryId,
        }));
      }, Effect.orDie);

      const rollsFor = Effect.fn("Board.rollsFor")(function* (siteKey: string) {
        const rows = yield* sql<{ rolls: number }>`SELECT rolls FROM entries WHERE site_key = ${siteKey}`;
        return rows[0]?.rolls ?? 0;
      }, Effect.orDie);

      const sitemap = sql<{ siteKey: string; lastJudgedAt: number }>`
        SELECT site_key, last_judged_at FROM entries WHERE hidden = 0 ORDER BY last_judged_at DESC LIMIT 50000`.pipe(
        Effect.orDie,
        Effect.withSpan("Board.sitemap"),
      );

      const judgments = Effect.fn("Board.judgments")(function* (entryId: EntryId) {
        const rows = yield* sql<JudgmentRow>`SELECT * FROM judgments WHERE entry_id = ${entryId} ORDER BY roll DESC`;
        return rows.map(toJudgment);
      }, Effect.orDie);

      const withoutSiteProfile = Effect.fn("Board.withoutSiteProfile")(function* (limit: number) {
        const rows = yield* sql<{ readonly id: string; readonly url: string }>`
          SELECT id, url FROM entries WHERE site_checked_at IS NULL AND hidden = 0
          ORDER BY first_judged_at ASC LIMIT ${limit}`;
        return rows.map((row) => ({ id: row.id as EntryId, url: row.url }));
      }, Effect.orDie);

      const setSiteProfile = Effect.fn("Board.setSiteProfile")(function* (id: EntryId, profile: SiteProfile | null) {
        yield* sql`
          UPDATE entries SET
            site_title = COALESCE(${profile?.title || null}, site_title),
            site_description = COALESCE(${profile?.description || null}, site_description),
            icon_url = COALESCE(${profile?.icon ?? null}, icon_url),
            site_checked_at = ${Date.now()}
          WHERE id = ${id}`;
      }, Effect.orDie);

      const withoutIcon = Effect.fn("Board.withoutIcon")(function* (limit: number) {
        const rows = yield* sql<{ readonly id: string; readonly siteKey: string; readonly iconUrl: string | null }>`
          SELECT id, site_key, icon_url FROM entries WHERE icon_version IS NULL AND hidden = 0
          ORDER BY first_judged_at ASC LIMIT ${limit}`;
        return rows.map((row) => ({ id: row.id as EntryId, siteKey: row.siteKey, iconUrl: row.iconUrl || null }));
      }, Effect.orDie);

      const setIconVersion = Effect.fn("Board.setIconVersion")(function* (id: EntryId, version: number) {
        yield* sql`UPDATE entries SET icon_version = ${version} WHERE id = ${id}`;
      }, Effect.orDie);

      const reasoning = Effect.fn("Board.reasoning")(function* (entryIds: ReadonlyArray<EntryId>) {
        if (entryIds.length === 0) return new Map<EntryId, string>();
        const rows = yield* sql<{ readonly id: string; readonly reasoning: string }>`
          SELECT e.id, j.reasoning FROM entries e JOIN judgments j ON j.id = e.judgment_id
          WHERE e.id IN ${sql.in(entryIds)}`;
        return new Map(rows.map((row) => [row.id as EntryId, row.reasoning]));
      }, Effect.orDie);

      const judgment = Effect.fn("Board.judgment")(function* (id: string) {
        const rows = yield* sql<JudgmentRow>`SELECT * FROM judgments WHERE id = ${id}`;
        return Option.map(Option.fromNullishOr(rows[0]), toJudgment);
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
                 COALESCE(
                   (SELECT r.started_at FROM reigns r WHERE r.entry_id = e.id AND r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1),
                   e.last_judged_at
                 ) AS since
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

      const recordClick = Effect.fn("Board.recordClick")(function* (siteKey: string) {
        const rows = yield* sql<{ url: string }>`
          UPDATE entries SET clicks = clicks + 1 WHERE site_key = ${siteKey} AND hidden = 0 RETURNING url`;
        return Option.map(Option.fromNullishOr(rows[0]), (row) => row.url);
      }, Effect.orDie);

      return Board.of({
        judgmentForOrder,
        rollsFor,
        sitemap,
        recordClick,
        findBySiteKey,
        getBySiteKey,
        page,
        top,
        tiedGroup,
        commitPlacement,
        judgments,
        withoutSiteProfile,
        setSiteProfile,
        withoutIcon,
        setIconVersion,
        reasoning,
        judgment,
        events,
        stats,
      });
    }),
  );
}
