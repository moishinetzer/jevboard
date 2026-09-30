import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { JUDGMENT_PRICE_CENTS } from "~/lib/format";
import { NotFound } from "../domain/errors";
import { type CustomerId, type EntryId, type JudgmentId, makeOrderId, type OrderId, randomId } from "../domain/ids";
import { IN_FLIGHT_STATUSES, type Order, type OrderKind, type OrderStatus, type RefundState, Verdict } from "../domain/models";

interface OrderRow {
  readonly id: string;
  readonly customerId: string;
  readonly siteKey: string;
  readonly url: string;
  readonly kind: OrderKind;
  readonly status: OrderStatus;
  readonly stageDetail: string | null;
  readonly error: string | null;
  readonly amountCents: number;
  readonly entryId: string | null;
  readonly judgmentId: string | null;
  readonly createdAt: number;
  readonly paidAt: number | null;
  readonly completedAt: number | null;
  readonly updatedAt: number;
  readonly refundState?: RefundState | null;
  readonly refundedAt?: number | null;
  readonly verdictJson?: string | null;
  readonly model?: string | null;
  readonly pagesCrawled?: string | null;
  readonly ogImage?: string | null;
}

/** Jev's verdict, parked on the order between the judging and placement stages. */
export interface StagedVerdict {
  readonly verdict: Verdict;
  readonly model: string;
  readonly pagesCrawled: ReadonlyArray<string>;
  readonly ogImage: string | null;
}

const decodeVerdict = Schema.decodeUnknownOption(Schema.fromJsonString(Verdict));

const toOrder = (row: OrderRow): Order => ({
  id: row.id as OrderId,
  customerId: row.customerId,
  siteKey: row.siteKey,
  url: row.url,
  kind: row.kind,
  status: row.status,
  stageDetail: row.stageDetail,
  error: row.error,
  amountCents: row.amountCents,
  entryId: row.entryId as EntryId | null,
  judgmentId: row.judgmentId as JudgmentId | null,
  createdAt: row.createdAt,
  paidAt: row.paidAt,
  completedAt: row.completedAt,
  updatedAt: row.updatedAt,
  refundState: row.refundState ?? null,
  refundedAt: row.refundedAt ?? null,
});

/**
 * Persistence for orders — one paid judgment each. The status column is the
 * pipeline's state machine; the judging page polls it.
 */
export class Orders extends Context.Service<
  Orders,
  {
    readonly create: (input: {
      readonly customerId: CustomerId;
      readonly siteKey: string;
      readonly url: string;
      readonly kind: OrderKind;
      readonly entryId: EntryId | null;
    }) => Effect.Effect<Order>;
    readonly get: (id: string) => Effect.Effect<Order, NotFound>;
    readonly find: (id: string) => Effect.Effect<Option.Option<Order>>;
    /** pending_payment -> paid. Returns false if the order was not pending (already paid). */
    readonly markPaid: (id: OrderId) => Effect.Effect<boolean>;
    /**
     * Progress updates. Never touch finished orders; when `token` is given,
     * only the job holding that claim may write (a stale job is ignored).
     */
    readonly setStage: (id: OrderId, status: OrderStatus, detail: string | null, token?: string) => Effect.Effect<void>;
    readonly setDetail: (id: OrderId, detail: string, token?: string) => Effect.Effect<void>;
    readonly complete: (id: OrderId, result: { readonly entryId: EntryId; readonly judgmentId: JudgmentId }) => Effect.Effect<void>;
    /**
     * Ends the order without a verdict. A paid order becomes due a refund.
     * Returns false when the order was already finished (or another job owns it).
     */
    readonly fail: (id: OrderId, error: string, token?: string) => Effect.Effect<boolean>;
    /** Paid orders still waiting for their refund, oldest first. */
    readonly refundsDue: (limit: number) => Effect.Effect<ReadonlyArray<Order>>;
    /** Counts one refund attempt; returns the new total. */
    readonly noteRefundAttempt: (id: OrderId) => Effect.Effect<number>;
    readonly markRefunded: (id: OrderId) => Effect.Effect<void>;
    /** Parks Jev's verdict on the order until the placement stage picks it up. */
    /** First writer wins; returns false if this job no longer owns the order or a verdict is already parked. */
    readonly stageVerdict: (id: OrderId, staged: StagedVerdict, token: string) => Effect.Effect<boolean>;
    /** The parked verdict, if the judging stage already finished. */
    readonly stagedVerdict: (id: OrderId) => Effect.Effect<Option.Option<StagedVerdict>>;
    /**
     * Atomically claims a paid order for judging: succeeds if it is freshly
     * paid, or in flight but untouched since `staleBefore` (a lost worker).
     * Queues deliver at least once; this keeps duplicate jobs from crawling twice.
     */
    readonly claim: (id: OrderId, staleBefore: number) => Effect.Effect<Option.Option<string>>;
    /**
     * Gives a claimed order back (status `paid`) so a queue retry can claim it
     * right away. `problem` is shown while it waits and becomes the error if
     * every retry fails.
     */
    readonly release: (id: OrderId, token: string, problem?: { readonly detail: string; readonly error: string }) => Effect.Effect<void>;
    /**
     * Orders the cron should re-queue: paid but unclaimed since `unclaimedBefore`
     * (their queue message was lost), or in flight and untouched since `before`.
     */
    readonly stalled: (before: number, unclaimedBefore: number) => Effect.Effect<ReadonlyArray<Order>>;
    /** Orders a worker must (re)process, oldest first — used on boot for crash recovery. */
    readonly inFlight: Effect.Effect<ReadonlyArray<Order>>;
    /** Unpaid orders created after `since` (epoch ms), newest first — for the payment sweeper. */
    readonly awaitingPayment: (since: number) => Effect.Effect<ReadonlyArray<Order>>;
    /** Recent orders for a customer (so the home page can say "your judgment is still cooking"). */
    readonly recentForCustomer: (customerId: string, limit: number) => Effect.Effect<ReadonlyArray<Order>>;
    /** The sites this customer paid to have judged: only they see those sites' "Rejudge" button. */
    readonly paidSites: (customerId: string) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("jevboard/Orders") {
  static readonly layer = Layer.effect(
    Orders,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const find = Effect.fn("Orders.find")(function* (id: string) {
        const rows = yield* sql<OrderRow>`SELECT * FROM orders WHERE id = ${id}`;
        return Option.map(Option.fromNullishOr(rows[0]), toOrder);
      }, Effect.orDie);

      const get = Effect.fn("Orders.get")(function* (id: string) {
        const order = yield* find(id);
        if (Option.isNone(order)) {
          return yield* new NotFound({ what: "order", message: "Jev has no record of that order." });
        }
        return order.value;
      });

      const create = Effect.fn("Orders.create")(function* (input: {
        readonly customerId: CustomerId;
        readonly siteKey: string;
        readonly url: string;
        readonly kind: OrderKind;
        readonly entryId: EntryId | null;
      }) {
        const now = Date.now();
        const order: Order = {
          id: makeOrderId(),
          customerId: input.customerId,
          siteKey: input.siteKey,
          url: input.url,
          kind: input.kind,
          status: "pending_payment",
          stageDetail: "Waiting for your $5",
          error: null,
          amountCents: JUDGMENT_PRICE_CENTS,
          entryId: input.entryId,
          judgmentId: null,
          createdAt: now,
          paidAt: null,
          completedAt: null,
          updatedAt: now,
          refundState: null,
          refundedAt: null,
        };
        yield* sql`INSERT INTO orders ${sql.insert({ ...order })}`;
        return order;
      }, Effect.orDie);

      const markPaid = Effect.fn("Orders.markPaid")(function* (id: OrderId) {
        const now = Date.now();
        const rows = yield* sql<{ id: string }>`
          UPDATE orders
          SET status = 'paid', paid_at = ${now}, updated_at = ${now}, stage_detail = 'Payment received. Jev is cracking his knuckles.'
          WHERE id = ${id} AND status = 'pending_payment'
          RETURNING id`;
        return rows.length > 0;
      }, Effect.orDie);

      /** Guards shared by every progress write. */
      const writable = (token: string | undefined) =>
        token === undefined
          ? sql`status NOT IN ('complete', 'failed')`
          : sql`status NOT IN ('complete', 'failed') AND claim_token = ${token}`;

      const setStage = Effect.fn("Orders.setStage")(function* (
        id: OrderId,
        status: OrderStatus,
        detail: string | null,
        token?: string,
      ) {
        yield* sql`
          UPDATE orders SET status = ${status}, stage_detail = ${detail}, error = NULL, updated_at = ${Date.now()}
          WHERE id = ${id} AND ${writable(token)}`;
      }, Effect.orDie);

      const setDetail = Effect.fn("Orders.setDetail")(function* (id: OrderId, detail: string, token?: string) {
        yield* sql`
          UPDATE orders SET stage_detail = ${detail}, updated_at = ${Date.now()}
          WHERE id = ${id} AND ${writable(token)}`;
      }, Effect.orDie);

      const complete = Effect.fn("Orders.complete")(function* (
        id: OrderId,
        result: { readonly entryId: EntryId; readonly judgmentId: JudgmentId },
      ) {
        const now = Date.now();
        yield* sql`
          UPDATE orders
          SET status = 'complete', stage_detail = 'Jev has spoken.', error = NULL, claim_token = NULL,
              entry_id = ${result.entryId}, judgment_id = ${result.judgmentId},
              completed_at = ${now}, updated_at = ${now}
          WHERE id = ${id} AND status NOT IN ('complete', 'failed')`;
      }, Effect.orDie);

      const fail = Effect.fn("Orders.fail")(function* (id: OrderId, error: string, token?: string) {
        const rows = yield* sql<{ id: string }>`
          UPDATE orders
          SET status = 'failed', error = ${error}, claim_token = NULL, updated_at = ${Date.now()},
              refund_state = CASE WHEN paid_at IS NOT NULL THEN 'due' ELSE refund_state END
          WHERE id = ${id} AND ${writable(token)}
          RETURNING id`;
        return rows.length > 0;
      }, Effect.orDie);

      const refundsDue = Effect.fn("Orders.refundsDue")(function* (limit: number) {
        const rows = yield* sql<OrderRow>`
          SELECT * FROM orders WHERE refund_state = 'due' ORDER BY updated_at ASC LIMIT ${limit}`;
        return rows.map(toOrder);
      }, Effect.orDie);

      const noteRefundAttempt = Effect.fn("Orders.noteRefundAttempt")(function* (id: OrderId) {
        const rows = yield* sql<{ refundAttempts: number }>`
          UPDATE orders SET refund_attempts = refund_attempts + 1 WHERE id = ${id} RETURNING refund_attempts`;
        return rows[0]?.refundAttempts ?? 0;
      }, Effect.orDie);

      const markRefunded = Effect.fn("Orders.markRefunded")(function* (id: OrderId) {
        const now = Date.now();
        yield* sql`
          UPDATE orders SET refund_state = 'done', refunded_at = ${now}, updated_at = ${now}
          WHERE id = ${id} AND refund_state = 'due'`;
      }, Effect.orDie);

      const stageVerdict = Effect.fn("Orders.stageVerdict")(function* (
        id: OrderId,
        staged: StagedVerdict,
        token: string,
      ) {
        const rows = yield* sql<{ id: string }>`
          UPDATE orders SET verdict_json = ${JSON.stringify(staged.verdict)}, model = ${staged.model},
            pages_crawled = ${JSON.stringify(staged.pagesCrawled)}, og_image = ${staged.ogImage},
            updated_at = ${Date.now()}
          WHERE id = ${id} AND verdict_json IS NULL AND ${writable(token)}
          RETURNING id`;
        return rows.length > 0;
      }, Effect.orDie);

      const stagedVerdict = Effect.fn("Orders.stagedVerdict")(function* (id: OrderId) {
        const rows = yield* sql<OrderRow>`SELECT * FROM orders WHERE id = ${id}`;
        const row = rows[0];
        if (!row?.verdictJson) return Option.none<StagedVerdict>();
        return Option.map(decodeVerdict(row.verdictJson), (verdict): StagedVerdict => {
          let pagesCrawled: ReadonlyArray<string> = [];
          try {
            const parsed: unknown = JSON.parse(row.pagesCrawled ?? "[]");
            if (Array.isArray(parsed)) pagesCrawled = parsed.filter((url): url is string => typeof url === "string");
          } catch {
            // Keep the verdict even if the page list is unreadable.
          }
          return { verdict, model: row.model ?? "unknown", pagesCrawled, ogImage: row.ogImage ?? null };
        });
      }, Effect.orDie);

      const claim = Effect.fn("Orders.claim")(function* (id: OrderId, staleBefore: number) {
        const now = Date.now();
        const token = randomId(16);
        const rows = yield* sql<{ id: string }>`
          UPDATE orders SET status = 'crawling', claim_token = ${token}, updated_at = ${now}
          WHERE id = ${id}
            AND (status = 'paid' OR (status IN ('crawling', 'judging') AND updated_at < ${staleBefore}))
          RETURNING id`;
        return rows.length > 0 ? Option.some(token) : Option.none<string>();
      }, Effect.orDie);

      const release = Effect.fn("Orders.release")(function* (
        id: OrderId,
        token: string,
        problem?: { readonly detail: string; readonly error: string },
      ) {
        yield* problem
          ? sql`
              UPDATE orders SET status = 'paid', claim_token = NULL, stage_detail = ${problem.detail},
                error = ${problem.error}, updated_at = ${Date.now()}
              WHERE id = ${id} AND claim_token = ${token} AND status NOT IN ('complete', 'failed')`
          : sql`
              UPDATE orders SET status = 'paid', claim_token = NULL, updated_at = ${Date.now()}
              WHERE id = ${id} AND claim_token = ${token} AND status NOT IN ('complete', 'failed')`;
      }, Effect.orDie);

      const stalled = Effect.fn("Orders.stalled")(function* (before: number, unclaimedBefore: number) {
        const rows = yield* sql<OrderRow>`
          SELECT * FROM orders
          WHERE (status = 'paid' AND updated_at < ${unclaimedBefore})
             OR (status IN ${sql.in(IN_FLIGHT_STATUSES)} AND updated_at < ${before})
          ORDER BY updated_at ASC LIMIT 50`;
        return rows.map(toOrder);
      }, Effect.orDie);

      const inFlight = sql<OrderRow>`
        SELECT * FROM orders WHERE status IN ${sql.in(IN_FLIGHT_STATUSES)} ORDER BY paid_at ASC`.pipe(
        Effect.map((rows) => rows.map(toOrder)),
        Effect.orDie,
        Effect.withSpan("Orders.inFlight"),
      );

      const awaitingPayment = Effect.fn("Orders.awaitingPayment")(function* (since: number) {
        const rows = yield* sql<OrderRow>`
          SELECT * FROM orders WHERE status = 'pending_payment' AND created_at >= ${since}
          ORDER BY created_at DESC LIMIT 100`;
        return rows.map(toOrder);
      }, Effect.orDie);

      const recentForCustomer = Effect.fn("Orders.recentForCustomer")(function* (customerId: string, limit: number) {
        const rows = yield* sql<OrderRow>`
          SELECT * FROM orders
          WHERE customer_id = ${customerId} AND status != 'pending_payment'
          ORDER BY created_at DESC LIMIT ${limit}`;
        return rows.map(toOrder);
      }, Effect.orDie);

      const paidSites = Effect.fn("Orders.paidSites")(function* (customerId: string) {
        const rows = yield* sql<{ readonly siteKey: string }>`
          SELECT DISTINCT site_key FROM orders
          WHERE customer_id = ${customerId} AND status != 'pending_payment'`;
        return rows.map((row) => row.siteKey);
      }, Effect.orDie);

      return Orders.of({
        create,
        get,
        find,
        markPaid,
        setStage,
        setDetail,
        complete,
        fail,
        refundsDue,
        noteRefundAttempt,
        markRefunded,
        stageVerdict,
        stagedVerdict,
        claim,
        release,
        stalled,
        inFlight,
        awaitingPayment,
        recentForCustomer,
        paidSites,
      });
    }),
  );
}
