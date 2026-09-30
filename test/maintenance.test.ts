import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { CustomerId } from "~/.server/domain/ids";
import { runMaintenance } from "~/.server/flows/maintenance";
import { Board } from "~/.server/services/Board";
import { JudgmentQueue } from "~/.server/services/JudgmentQueue";
import { Orders } from "~/.server/services/Orders";
import { Payments } from "~/.server/services/Payments";
import { FakePaymentsLive } from "~/.server/services/payments/FakePayments";
import { makeTestLayer, type Script } from "./support/layers";

const customer = CustomerId.make("cTestCustomer0000000000");

const layerFor = (script: Script) =>
  JudgmentQueue.layerInProcess.pipe(Layer.provideMerge(makeTestLayer(script, [], FakePaymentsLive)));

/** Waits until the order reaches a terminal state (the in-process queue runs on a fiber). */
const settled = (orderId: string) =>
  Effect.gen(function* () {
    const orders = yield* Orders;
    for (let i = 0; i < 200; i++) {
      const order = yield* orders.get(orderId);
      if (order.status === "complete" || order.status === "failed") return order;
      yield* Effect.yieldNow;
      yield* Effect.sleep("5 millis");
    }
    return yield* orders.get(orderId);
  });

describe("maintenance (cron trigger)", () => {
  it.live("judges buyers who paid and closed the tab", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const payments = yield* Payments;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "tab-closer.com",
        url: "https://tab-closer.com/",
        kind: "new",
        entryId: null,
      });
      // Nothing happens for unpaid orders…
      yield* runMaintenance;
      assert.strictEqual((yield* orders.get(order.id)).status, "pending_payment");

      // …but once the payment exists, the sweeper confirms it and the judgment runs.
      yield* payments.simulatePayment!(order.id);
      yield* runMaintenance;
      const done = yield* settled(order.id);
      assert.strictEqual(done.status, "complete");
      assert.strictEqual((yield* (yield* Board).getBySiteKey("tab-closer.com")).score, 640);
    }).pipe(Effect.provide(layerFor({ scores: { "tab-closer.com": [640] }, strength: {}, duels: 0 }))),
  );

  it.live("re-queues judgments that stalled mid-flight", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const sql = yield* SqlClient.SqlClient;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "stuck.io",
        url: "https://stuck.io/",
        kind: "new",
        entryId: null,
      });
      yield* orders.markPaid(order.id);
      // Simulate a worker that died while judging, well past the stale window.
      yield* sql`UPDATE orders SET status = 'judging', updated_at = ${Date.now() - 45 * 60_000} WHERE id = ${order.id}`;
      yield* runMaintenance;
      const done = yield* settled(order.id);
      assert.strictEqual(done.status, "complete");
    }).pipe(Effect.provide(layerFor({ scores: { "stuck.io": [333] }, strength: {}, duels: 0 }))),
  );

  it.live("re-queues paid orders whose queue message was lost", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const sql = yield* SqlClient.SqlClient;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "lost-message.com",
        url: "https://lost-message.com/",
        kind: "new",
        entryId: null,
      });
      yield* orders.markPaid(order.id); // …and the enqueue never happened
      yield* sql`UPDATE orders SET updated_at = ${Date.now() - 6 * 60_000} WHERE id = ${order.id}`;
      yield* runMaintenance;
      assert.strictEqual((yield* settled(order.id)).status, "complete");
    }).pipe(Effect.provide(layerFor({ scores: { "lost-message.com": [444] }, strength: {}, duels: 0 }))),
  );

  it.live("refunds paid orders whose refund didn't go through when they failed", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const payments = yield* Payments;
      const sql = yield* SqlClient.SqlClient;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "refund-me.com",
        url: "https://refund-me.com/",
        kind: "new",
        entryId: null,
      });
      yield* payments.simulatePayment!(order.id);
      yield* orders.markPaid(order.id);
      // Failed after payment, but the refund call never happened (say the worker was evicted).
      yield* orders.fail(order.id, "Your site kept timing out, even after several tries.");
      assert.strictEqual((yield* orders.get(order.id)).refundState, "due");

      yield* runMaintenance;
      const refunded = yield* orders.get(order.id);
      assert.strictEqual(refunded.refundState, "done");
      assert.isNotNull(refunded.refundedAt);
      const [row] = yield* sql<{ refundedAt: number | null }>`
        SELECT refunded_at FROM fake_payments WHERE order_id = ${order.id}`;
      assert.isNotNull(row?.refundedAt ?? null);

      // A second run leaves it alone.
      yield* runMaintenance;
      assert.strictEqual((yield* orders.get(order.id)).refundedAt, refunded.refundedAt);
    }).pipe(Effect.provide(layerFor({ scores: {}, strength: {}, duels: 0 }))),
  );
});
