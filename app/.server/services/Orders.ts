import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { JUDGMENT_PRICE_CENTS } from "~/lib/format";
import { NotFound } from "../domain/errors";
import { type CustomerId, type EntryId, type JudgmentId, makeOrderId, type OrderId } from "../domain/ids";
import { IN_FLIGHT_STATUSES, type Order, type OrderKind, type OrderStatus } from "../domain/models";

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
}

const toOrder = (row: OrderRow): Order => ({
  ...row,
  id: row.id as OrderId,
  entryId: row.entryId as EntryId | null,
  judgmentId: row.judgmentId as JudgmentId | null,
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
    readonly setStage: (id: OrderId, status: OrderStatus, detail: string | null) => Effect.Effect<void>;
    readonly setDetail: (id: OrderId, detail: string) => Effect.Effect<void>;
    readonly complete: (id: OrderId, result: { readonly entryId: EntryId; readonly judgmentId: JudgmentId }) => Effect.Effect<void>;
    readonly fail: (id: OrderId, error: string) => Effect.Effect<void>;
    /** failed -> paid, so a paid-for judgment can be retried for free. */
    readonly retry: (id: OrderId) => Effect.Effect<boolean>;
    /** Orders a worker must (re)process, oldest first — used on boot for crash recovery. */
    readonly inFlight: Effect.Effect<ReadonlyArray<Order>>;
    /** Unpaid orders created after `since` (epoch ms), oldest first — for the payment sweeper. */
    readonly awaitingPayment: (since: number) => Effect.Effect<ReadonlyArray<Order>>;
    /** Recent orders for a customer (so the home page can say "your judgment is still cooking"). */
    readonly recentForCustomer: (customerId: string, limit: number) => Effect.Effect<ReadonlyArray<Order>>;
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

      const setStage = Effect.fn("Orders.setStage")(function* (
        id: OrderId,
        status: OrderStatus,
        detail: string | null,
      ) {
        yield* sql`
          UPDATE orders SET status = ${status}, stage_detail = ${detail}, error = NULL, updated_at = ${Date.now()}
          WHERE id = ${id}`;
      }, Effect.orDie);

      const setDetail = Effect.fn("Orders.setDetail")(function* (id: OrderId, detail: string) {
        yield* sql`UPDATE orders SET stage_detail = ${detail}, updated_at = ${Date.now()} WHERE id = ${id}`;
      }, Effect.orDie);

      const complete = Effect.fn("Orders.complete")(function* (
        id: OrderId,
        result: { readonly entryId: EntryId; readonly judgmentId: JudgmentId },
      ) {
        const now = Date.now();
        yield* sql`
          UPDATE orders
          SET status = 'complete', stage_detail = 'Jev has spoken.', error = NULL,
              entry_id = ${result.entryId}, judgment_id = ${result.judgmentId},
              completed_at = ${now}, updated_at = ${now}
          WHERE id = ${id}`;
      }, Effect.orDie);

      const fail = Effect.fn("Orders.fail")(function* (id: OrderId, error: string) {
        yield* sql`
          UPDATE orders SET status = 'failed', error = ${error}, updated_at = ${Date.now()}
          WHERE id = ${id}`;
      }, Effect.orDie);

      const retry = Effect.fn("Orders.retry")(function* (id: OrderId) {
        const rows = yield* sql<{ id: string }>`
          UPDATE orders
          SET status = 'paid', error = NULL, stage_detail = 'Retrying. Jev is giving it another go.', updated_at = ${Date.now()}
          WHERE id = ${id} AND status = 'failed'
          RETURNING id`;
        return rows.length > 0;
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
          ORDER BY created_at ASC LIMIT 200`;
        return rows.map(toOrder);
      }, Effect.orDie);

      const recentForCustomer = Effect.fn("Orders.recentForCustomer")(function* (customerId: string, limit: number) {
        const rows = yield* sql<OrderRow>`
          SELECT * FROM orders
          WHERE customer_id = ${customerId} AND status != 'pending_payment'
          ORDER BY created_at DESC LIMIT ${limit}`;
        return rows.map(toOrder);
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
        retry,
        inFlight,
        awaitingPayment,
        recentForCustomer,
      });
    }),
  );
}
