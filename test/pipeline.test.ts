import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { CustomerId, type OrderId } from "~/.server/domain/ids";
import { Board } from "~/.server/services/Board";
import { Orders } from "~/.server/services/Orders";
import { Pipeline } from "~/.server/services/Pipeline";
import { makeTestLayer, type Script } from "./support/layers";

const customer = CustomerId.make("cTestCustomer0000000000");

/** Creates a paid order for `siteKey` and runs it through the pipeline. */
const judge = (siteKey: string) =>
  Effect.gen(function* () {
    const orders = yield* Orders;
    const board = yield* Board;
    const existing = yield* board.findBySiteKey(siteKey);
    const order = yield* orders.create({
      customerId: customer,
      siteKey,
      url: `https://${siteKey}/`,
      kind: Option.isSome(existing) ? "reroll" : "new",
      entryId: null,
    });
    assert.isTrue(yield* orders.markPaid(order.id));
    yield* (yield* Pipeline).run(order.id);
    return yield* orders.get(order.id);
  });

const ranking = Effect.gen(function* () {
  const page = yield* (yield* Board).page({ page: 1, pageSize: 100 });
  return page.entries.map((entry) => `${entry.rank}:${entry.siteKey}:${entry.score}`);
});

const script = (partial: Partial<Script>): Script => ({ scores: {}, strength: {}, duels: 0, ...partial });

describe("Pipeline", () => {
  it.effect("places a first judgment, crowns it and completes the order", () => {
    const s = script({ scores: { "alpha.com": [812] } });
    return Effect.gen(function* () {
      const order = yield* judge("alpha.com");
      assert.strictEqual(order.status, "complete");
      assert.isNotNull(order.judgmentId);

      const entry = yield* (yield* Board).getBySiteKey("alpha.com");
      assert.strictEqual(entry.score, 812);
      assert.strictEqual(entry.rank, 1);
      assert.strictEqual(entry.rolls, 1);
      assert.strictEqual(entry.entryNumber, 1);

      const events = yield* (yield* Board).events({ limit: 10 });
      assert.deepStrictEqual(
        events.map((event) => event.kind).sort(),
        ["crowned", "placed"],
      );
      const stats = yield* (yield* Board).stats;
      assert.strictEqual(stats.revenueCents, 500);
      assert.strictEqual(stats.king?.siteKey, "alpha.com");
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("orders entries by score and settles exact ties with duels", () => {
    const s = script({
      scores: { "a.com": [700], "b.com": [900], "c.com": [700] },
      strength: { "a.com": 1, "c.com": 2 },
    });
    return Effect.gen(function* () {
      yield* judge("a.com");
      yield* judge("b.com");
      yield* judge("c.com"); // ties a.com at 700 and is stronger
      assert.strictEqual(s.duels, 1);
      assert.deepStrictEqual(yield* ranking, ["1:b.com:900", "2:c.com:700", "3:a.com:700"]);

      const board = yield* Board;
      const c = yield* board.getBySiteKey("c.com");
      const duels = yield* board.duelsForEntry(c.id, 10);
      assert.strictEqual(duels.length, 1);
      assert.strictEqual(duels[0]!.winnerId, c.id);
      assert.strictEqual(duels[0]!.opponentSiteKey, "a.com");
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("binary-inserts into a large tie group with ⌈log2(n+1)⌉ duels", () => {
    const sites = ["s1.com", "s2.com", "s3.com", "s4.com", "s5.com", "s6.com", "s7.com"];
    // Strengths deliberately not in submission order.
    const strength: Record<string, number> = { "s1.com": 4, "s2.com": 9, "s3.com": 1, "s4.com": 7, "s5.com": 3, "s6.com": 8, "s7.com": 5 };
    const s = script({ scores: Object.fromEntries(sites.map((site) => [site, [555]])), strength });
    return Effect.gen(function* () {
      let bound = 0;
      for (const [index, site] of sites.entries()) {
        yield* judge(site);
        // Placing among `index` rivals takes at most ⌈log2(index + 1)⌉ duels.
        bound += Math.ceil(Math.log2(index + 1));
        assert.isAtMost(s.duels, bound);
      }
      const order = (yield* ranking).map((row) => row.split(":")[1]);
      const expected = [...sites].sort((a, b) => strength[b]! - strength[a]!);
      assert.deepStrictEqual(order, expected);
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("rerolls replace the score (even downwards) and keep history", () => {
    const s = script({ scores: { "x.com": [900, 400], "y.com": [650] } });
    return Effect.gen(function* () {
      yield* judge("x.com");
      yield* judge("y.com");
      const reroll = yield* judge("x.com");
      assert.strictEqual(reroll.kind, "reroll");

      const board = yield* Board;
      const x = yield* board.getBySiteKey("x.com");
      assert.strictEqual(x.score, 400);
      assert.strictEqual(x.rolls, 2);
      assert.strictEqual(x.bestScore, 900);
      assert.strictEqual(x.worstScore, 400);
      assert.strictEqual(x.lastDelta, -500);
      assert.strictEqual(x.rank, 2);

      const history = yield* board.judgments(x.id);
      assert.deepStrictEqual(history.map((j) => [j.roll, j.score, j.previousScore]), [[2, 400, 900], [1, 900, null]]);
      assert.deepStrictEqual(history.map((j) => j.serial), [3, 1]);

      const events = yield* board.events({ limit: 20 });
      assert.isTrue(events.some((event) => event.kind === "dethroned" && event.siteKey === "x.com"));
      assert.isTrue(events.some((event) => event.kind === "crowned" && event.siteKey === "y.com"));
      const hall = yield* board.hall;
      assert.strictEqual(hall.biggestDrops[0]?.siteKey, "x.com");
      assert.strictEqual(hall.reigns.length, 2);
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("keeps flagged sites off the board", () => {
    const s = script({
      scores: { "parked.com": [12], "real.com": [500] },
      overrides: { "parked.com": { contentFlag: "parked" } },
    });
    return Effect.gen(function* () {
      const order = yield* judge("parked.com");
      assert.strictEqual(order.status, "complete");
      yield* judge("real.com");
      assert.deepStrictEqual(yield* ranking, ["1:real.com:500"]);
      const board = yield* Board;
      assert.isTrue(Option.isNone(yield* board.findBySiteKey("parked.com")));
      const judgment = yield* board.judgment(order.judgmentId!);
      assert.strictEqual(Option.getOrThrow(judgment).contentFlag, "parked");
      const events = yield* board.events({ limit: 20 });
      assert.isFalse(events.some((event) => event.siteKey === "parked.com"));
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("records bribe attempts", () => {
    const s = script({ scores: { "sly.io": [300] }, overrides: { "sly.io": { manipulationAttempt: true } } });
    return Effect.gen(function* () {
      yield* judge("sly.io");
      const board = yield* Board;
      assert.isTrue((yield* board.getBySiteKey("sly.io")).manipulationAttempt);
      assert.strictEqual((yield* board.stats).bribesCaught, 1);
      assert.isTrue((yield* board.events({ limit: 10 })).some((event) => event.kind === "bribe"));
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.effect("fails the order with a friendly message when the site is unreachable, and allows a free retry", () => {
    const s = script({ scores: { "gone.com": [700] } });
    return Effect.gen(function* () {
      const failed = yield* judge("gone.com");
      assert.strictEqual(failed.status, "failed");
      assert.match(failed.error ?? "", /domain/i);

      const orders = yield* Orders;
      assert.isTrue(yield* orders.retry(failed.id as OrderId));
      assert.strictEqual((yield* orders.get(failed.id)).status, "paid");
      // A second retry of a non-failed order is refused.
      assert.isFalse(yield* orders.retry(failed.id as OrderId));
    }).pipe(Effect.provide(makeTestLayer(s, ["gone.com"])));
  });

  it.effect("ignores orders that were never paid", () => {
    const s = script({ scores: { "free.com": [999] } });
    return Effect.gen(function* () {
      const orders = yield* Orders;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "free.com",
        url: "https://free.com/",
        kind: "new",
        entryId: null,
      });
      yield* (yield* Pipeline).run(order.id);
      assert.strictEqual((yield* orders.get(order.id)).status, "pending_payment");
      assert.strictEqual((yield* (yield* Board).stats).entries, 0);
    }).pipe(Effect.provide(makeTestLayer(s)));
  });

  it.live("claims orders so a duplicate queue delivery never judges twice", () => {
    const s = script({ scores: { "dup.com": [701] }, judged: 0, judgeDelayMs: 30 });
    return Effect.gen(function* () {
      const orders = yield* Orders;
      const pipeline = yield* Pipeline;
      const order = yield* orders.create({
        customerId: customer,
        siteKey: "dup.com",
        url: "https://dup.com/",
        kind: "new",
        entryId: null,
      });
      yield* orders.markPaid(order.id);
      const [first, second] = yield* Effect.all([pipeline.judge(order.id), pipeline.judge(order.id)], {
        concurrency: 2,
      });
      assert.deepStrictEqual([first, second].sort(), ["judged", "skipped"]);
      assert.strictEqual(s.judged, 1);
      // A redelivery after the verdict is staged just forwards to placement again.
      assert.strictEqual(yield* pipeline.judge(order.id), "judged");
      yield* pipeline.place(order.id);
      yield* pipeline.place(order.id); // duplicate placement message: no-op
      const board = yield* Board;
      assert.strictEqual((yield* board.getBySiteKey("dup.com")).rolls, 1);
      assert.strictEqual((yield* board.stats).judgments, 1);
    }).pipe(Effect.provide(makeTestLayer(s)));
  });
});
