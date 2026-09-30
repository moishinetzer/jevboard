import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { CustomerId } from "~/.server/domain/ids";
import { Orders } from "~/.server/services/Orders";
import { BOARD_VIEWS, Views } from "~/.server/services/Views";
import { SqliteLocal } from "./support/sqlite";

const layer = Layer.mergeAll(Views.layer, Orders.layer).pipe(Layer.provideMerge(SqliteLocal()));

describe("Views", () => {
  it.effect("counts views per site and per day, zero-filling quiet days", () =>
    Effect.gen(function* () {
      const views = yield* Views;
      yield* views.record([BOARD_VIEWS, "acme.com"]);
      yield* views.record(["acme.com"]);
      yield* views.record([]);

      const acme = yield* views.daily("acme.com", 7);
      assert.strictEqual(acme.length, 7);
      assert.deepStrictEqual(acme.map((day) => day.views), [0, 0, 0, 0, 0, 0, 2]);
      assert.strictEqual(acme.at(-1)!.day, new Date().toISOString().slice(0, 10));
      assert.isTrue(acme.every((day, index) => index === 0 || day.day > acme[index - 1]!.day));

      const board = yield* views.daily(BOARD_VIEWS, 7);
      assert.strictEqual(board.at(-1)!.views, 1);
      assert.strictEqual((yield* views.daily("nobody.com", 7)).reduce((sum, day) => sum + day.views, 0), 0);
    }).pipe(Effect.provide(layer)),
  );
});

describe("Orders.paidForSite", () => {
  const buyer = CustomerId.make("cBuyer00000000000000000");
  const stranger = CustomerId.make("cStranger00000000000000");

  it.effect("is true only for the customer who paid for that site", () =>
    Effect.gen(function* () {
      const orders = yield* Orders;
      const order = yield* orders.create({
        customerId: buyer,
        siteKey: "acme.com",
        url: "https://acme.com/",
        kind: "new",
        entryId: null,
      });
      // Checkout started but not paid: not theirs to rejudge yet.
      assert.isFalse(yield* orders.paidForSite(buyer, "acme.com"));

      yield* orders.markPaid(order.id);
      assert.isTrue(yield* orders.paidForSite(buyer, "acme.com"));
      assert.isFalse(yield* orders.paidForSite(stranger, "acme.com"));
      assert.isFalse(yield* orders.paidForSite(buyer, "other.com"));
    }).pipe(Effect.provide(layer)),
  );
});
