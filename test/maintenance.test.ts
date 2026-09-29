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

const layerFor = (script: Script) => {
  const base = makeTestLayer(script);
  return JudgmentQueue.layerInProcess.pipe(
    Layer.provideMerge(FakePaymentsLive),
    Layer.provideMerge(base),
  );
};

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
});

