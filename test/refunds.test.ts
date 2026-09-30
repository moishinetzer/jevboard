import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CustomerId } from "~/.server/domain/ids";
import { Orders } from "~/.server/services/Orders";
import type { Payments } from "~/.server/services/Payments";
import { makeRefunder } from "~/.server/services/refunds";
import { SqliteLocal } from "./support/sqlite";

const layer = Orders.layer.pipe(Layer.provideMerge(SqliteLocal()));

/** Payments that never find the charge to refund. */
const noCharge = {
  refund: () => Effect.succeed("nothing_to_refund" as const),
} as unknown as Payments["Service"];

describe("refunds", () => {
  it.effect("never marks a refund done when no payment was found: it's parked for a person", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const order = yield* orders.create({
        customerId: CustomerId.make("cBuyer00000000000000000"),
        siteKey: "acme.com",
        url: "https://acme.com/",
        kind: "new",
        entryId: null,
      });
      yield* orders.markPaid(order.id);
      yield* orders.fail(order.id, "Jev fell over");
      assert.strictEqual((yield* orders.get(order.id)).refundState, "due");

      const refund = makeRefunder(orders, noCharge);
      for (let attempt = 1; attempt < 5; attempt++) assert.strictEqual(yield* refund(order.id), "due");
      assert.strictEqual(yield* refund(order.id), "unresolved");

      const after = yield* orders.get(order.id);
      assert.strictEqual(after.refundState, "unresolved");
      assert.isNull(after.refundedAt);
      // The cron stops retrying it.
      assert.deepStrictEqual((yield* orders.refundsDue(10)).map((due) => due.id), []);
    }).pipe(Effect.provide(layer)),
  );
});
