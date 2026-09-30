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

      // The same zero-filled days as `daily`, for many sites in one query.
      const many = yield* views.dailyMany(["acme.com", BOARD_VIEWS, "nobody.com"], 7);
      assert.deepStrictEqual(many.get("acme.com"), [0, 0, 0, 0, 0, 0, 2]);
      assert.deepStrictEqual(many.get(BOARD_VIEWS), [0, 0, 0, 0, 0, 0, 1]);
      assert.isFalse(many.has("nobody.com"));
      assert.strictEqual((yield* views.dailyMany([], 30)).size, 0);
    }).pipe(Effect.provide(layer)),
  );
});

describe("Orders.paidSites", () => {
  const buyer = CustomerId.make("cBuyer00000000000000000");
  const stranger = CustomerId.make("cStranger00000000000000");

  it.effect("lists the sites a customer paid for, and only theirs", () =>
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
      assert.deepStrictEqual(yield* orders.paidSites(buyer), []);

      yield* orders.markPaid(order.id);
      assert.deepStrictEqual(yield* orders.paidSites(buyer), ["acme.com"]);
      assert.deepStrictEqual(yield* orders.paidSites(stranger), []);
    }).pipe(Effect.provide(layer)),
  );
});
