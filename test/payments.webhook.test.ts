import { createHmac } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { AppConfig } from "~/.server/config";
import { PaymentError } from "~/.server/domain/errors";
import { OrderId } from "~/.server/domain/ids";
import type { Order, OrderStatus } from "~/.server/domain/models";
import { JudgmentQueue } from "~/.server/services/JudgmentQueue";
import { Orders } from "~/.server/services/Orders";
import {
  decideWebhook,
  handleAutumnWebhook,
  type SvixHeaders,
  signSvix,
  verifySvixSignature,
} from "~/.server/services/payments/webhook";

// Independent reference signer (node:crypto) — the app itself uses Web Crypto.
const SECRET_B64 = "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const SECRET = `whsec_${SECRET_B64}`;
const nodeSign = (secret: string, id: string, timestamp: number | string, body: string) =>
  `v1,${createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;

const NOW = 1_790_000_000; // seconds
const MSG_ID = "msg_2mJevboardTest0000000001";
const BODY = JSON.stringify({ type: "billing.updated", data: { customer_id: "jev_oAbC", plan_changes: [] } });

const headersFor = (signature: string, timestamp: number | string = NOW, id = MSG_ID): SvixHeaders => ({
  id,
  timestamp: String(timestamp),
  signature,
});

const verify = (headers: SvixHeaders, body = BODY, secret = SECRET) =>
  verifySvixSignature({ secret, headers, body, nowSeconds: NOW });

describe("Svix signature verification", () => {
  it.effect("matches Svix's documented example", () =>
    Effect.gen(function* () {
      // https://docs.svix.com/receiving/verifying-payloads/how-manual
      const body = '{"test": 2432232314}';
      const signature = yield* signSvix(SECRET, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, body);
      assert.strictEqual(signature, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
      const result = yield* verifySvixSignature({
        secret: SECRET,
        headers: { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature },
        body,
        nowSeconds: 1614265330 + 60,
      });
      assert.deepStrictEqual(result, { ok: true });
    }),
  );

  it.effect("accepts a valid signature (Web Crypto agrees with node:crypto)", () =>
    Effect.gen(function* () {
      const signature = nodeSign(SECRET, MSG_ID, NOW, BODY);
      assert.strictEqual(yield* signSvix(SECRET, MSG_ID, NOW, BODY), signature);
      assert.deepStrictEqual(yield* verify(headersFor(signature)), { ok: true });
    }),
  );

  it.effect("accepts a secret without the whsec_ prefix", () =>
    Effect.gen(function* () {
      const signature = nodeSign(SECRET, MSG_ID, NOW, BODY);
      assert.deepStrictEqual(yield* verify(headersFor(signature), BODY, SECRET_B64), { ok: true });
    }),
  );

  it.effect("rejects a tampered body", () =>
    Effect.gen(function* () {
      const signature = nodeSign(SECRET, MSG_ID, NOW, BODY);
      const result = yield* verify(headersFor(signature), BODY.replace("jev_oAbC", "jev_oXyZ"));
      assert.deepStrictEqual(result, { ok: false, status: 401, reason: "no matching signature" });
    }),
  );

  it.effect("rejects a tampered message id or timestamp", () =>
    Effect.gen(function* () {
      const signature = nodeSign(SECRET, MSG_ID, NOW, BODY);
      assert.isFalse((yield* verify(headersFor(signature, NOW, "msg_other"))).ok);
      assert.isFalse((yield* verify(headersFor(signature, NOW - 1))).ok);
    }),
  );

  it.effect("rejects the wrong secret", () =>
    Effect.gen(function* () {
      const signature = nodeSign("whsec_c2VjcmV0LXRoYXQtaXMtbm90LW91cnM=", MSG_ID, NOW, BODY);
      const result = yield* verify(headersFor(signature));
      assert.isFalse(result.ok);
      if (!result.ok) assert.strictEqual(result.status, 401);
    }),
  );

  it.effect("rejects stale and future timestamps (> 5 minutes)", () =>
    Effect.gen(function* () {
      const stale = NOW - 301;
      const future = NOW + 301;
      const staleResult = yield* verify(headersFor(nodeSign(SECRET, MSG_ID, stale, BODY), stale));
      const futureResult = yield* verify(headersFor(nodeSign(SECRET, MSG_ID, future, BODY), future));
      assert.deepStrictEqual(staleResult, { ok: false, status: 401, reason: "timestamp outside the 5 minute tolerance" });
      assert.deepStrictEqual(futureResult, {
        ok: false,
        status: 401,
        reason: "timestamp outside the 5 minute tolerance",
      });
      // Inside the window is fine.
      const recent = NOW - 299;
      assert.deepStrictEqual(yield* verify(headersFor(nodeSign(SECRET, MSG_ID, recent, BODY), recent)), { ok: true });
    }),
  );

  it.effect("accepts any matching v1 entry among several (secret rotation)", () =>
    Effect.gen(function* () {
      const valid = nodeSign(SECRET, MSG_ID, NOW, BODY);
      const other = nodeSign("whsec_b2xkLXNlY3JldC1iZWZvcmUtcm90YXRpb24=", MSG_ID, NOW, BODY);
      assert.deepStrictEqual(yield* verify(headersFor(`${other} ${valid}`)), { ok: true });
      assert.deepStrictEqual(yield* verify(headersFor(`v1,not-base64!! ${valid} v1a,xyz`)), { ok: true });
      assert.isFalse((yield* verify(headersFor(`${other} v1,${"A".repeat(44)}`))).ok);
    }),
  );

  it.effect("only honours v1 signatures", () =>
    Effect.gen(function* () {
      const valid = nodeSign(SECRET, MSG_ID, NOW, BODY);
      const result = yield* verify(headersFor(valid.replace(/^v1,/, "v2,")));
      assert.isFalse(result.ok);
    }),
  );

  it.effect("400s on missing or malformed headers", () =>
    Effect.gen(function* () {
      const valid = nodeSign(SECRET, MSG_ID, NOW, BODY);
      assert.deepStrictEqual(yield* verify({ id: MSG_ID, timestamp: String(NOW), signature: null }), {
        ok: false,
        status: 400,
        reason: "missing Svix signature headers",
      });
      assert.deepStrictEqual(yield* verify({ id: null, timestamp: String(NOW), signature: valid }), {
        ok: false,
        status: 400,
        reason: "missing Svix signature headers",
      });
      assert.deepStrictEqual(yield* verify(headersFor(valid, "17900e5")), {
        ok: false,
        status: 400,
        reason: "malformed svix-timestamp",
      });
    }),
  );

  it.effect("an unusable secret rejects everything instead of throwing", () =>
    Effect.gen(function* () {
      const valid = nodeSign(SECRET, MSG_ID, NOW, BODY);
      const result = yield* verify(headersFor(valid), BODY, "whsec_");
      assert.isFalse(result.ok);
    }),
  );
});

describe("decideWebhook", () => {
  const ORDER = "oAbCdEfGhIjKlMnOpQrStUv";
  const activated = { action: "activated", purchase: { plan_id: "judgment", status: "active", expires_at: null } };

  it("settles a billing.updated that activates a purchase for a jev_ customer", () => {
    assert.deepStrictEqual(
      decideWebhook({
        type: "billing.updated",
        data: {
          object: "billing.updated",
          customer_id: `jev_${ORDER}`,
          entity_id: null,
          plan_changes: [{ ...activated, previous_attributes: null, item_changes: [] }],
          tags: [],
        },
      }),
      { _tag: "Settle", orderId: ORDER },
    );
  });

  it("tolerates envelope extras and missing plan_changes (payment is re-verified anyway)", () => {
    assert.deepStrictEqual(
      decideWebhook({ id: "evt_1", occurred_at: 1790000000000, type: "billing.updated", data: { customer_id: `jev_${ORDER}` } }),
      { _tag: "Settle", orderId: ORDER },
    );
  });

  it("settles the legacy customer.products.updated event", () => {
    assert.deepStrictEqual(
      decideWebhook({ type: "customer.products.updated", data: { scenario: "new", customer: { id: `jev_${ORDER}` } } }),
      { _tag: "Settle", orderId: ORDER },
    );
  });

  it("ignores everything else", () => {
    const ignored = (payload: unknown) => decideWebhook(payload)._tag === "Ignore";
    assert.isTrue(ignored({ type: "invoice.finalized", data: { customer_id: `jev_${ORDER}` } }));
    assert.isTrue(ignored({ type: "billing.updated", data: { customer_id: "cus_someone_else", plan_changes: [activated] } }));
    assert.isTrue(ignored({ type: "billing.updated", data: { customer_id: "jev_../../x", plan_changes: [activated] } }));
    assert.isTrue(
      ignored({ type: "billing.updated", data: { customer_id: `jev_${ORDER}`, plan_changes: [{ action: "expired" }] } }),
    );
    assert.isTrue(ignored({ type: "billing.updated" }));
    assert.isTrue(ignored("nope"));
    assert.isTrue(ignored(null));
  });
});

describe("handleAutumnWebhook", () => {
  const ORDER = OrderId.make("oAbCdEfGhIjKlMnOpQrStUv");
  const VISITOR = "cZyXwVuTsRqPoNmLkJiHgFe";
  const NOW_MS = NOW * 1000;

  const order = (status: OrderStatus): Order => ({
    id: ORDER,
    customerId: VISITOR,
    siteKey: "acme.com",
    url: "https://acme.com/",
    kind: "new",
    status,
    stageDetail: null,
    error: null,
    amountCents: 500,
    entryId: null,
    judgmentId: null,
    createdAt: NOW_MS - 60_000,
    paidAt: null,
    completedAt: null,
    updatedAt: NOW_MS - 60_000,
    refundState: null,
    refundedAt: null,
  });

  const autumnConfig = (webhookSecret: Option.Option<Redacted.Redacted<string>>) =>
    AppConfig.layerTest({
      autumn: Option.some({
        secretKey: Redacted.make("am_sk_test_x"),
        apiUrl: "https://api.useautumn.test/v1",
        apiVersion: "2.4.0",
        planId: "judgment",
        featureId: "judgment",
        webhookSecret,
      }),
    });

  /** Orders + queue fakes; `settle` flips the order to paid unless told to fail. */
  const harness = (options: {
    readonly initial: Option.Option<OrderStatus>;
    readonly settleFails?: boolean;
    readonly secrets?: string;
  }) => {
    let status = options.initial;
    const settled: Array<{ orderId: string; customerId: string }> = [];
    const layer = Layer.mergeAll(
      autumnConfig(Option.some(Redacted.make(options.secrets ?? SECRET))),
      Layer.mock(Orders, { find: () => Effect.sync(() => Option.map(status, order)) }),
      Layer.mock(JudgmentQueue, {
        settle: (orderId, customerId) =>
          Effect.suspend(() => {
            settled.push({ orderId, customerId });
            if (options.settleFails) return Effect.fail(new PaymentError({ message: "Autumn is down", status: 503 }));
            status = Option.some("paid");
            return Effect.void;
          }),
      }),
    );
    return { settled, layer };
  };

  const event = JSON.stringify({
    type: "billing.updated",
    data: {
      object: "billing.updated",
      customer_id: `jev_${ORDER}`,
      plan_changes: [{ action: "activated", purchase: { plan_id: "judgment", status: "active", expires_at: null } }],
      tags: [],
    },
  });

  const signedRequest = (body: string, signature = nodeSign(SECRET, MSG_ID, NOW, body), method = "POST") =>
    new Request("https://jevboard.test/api/autumn/webhook", {
      method,
      headers: { "content-type": "application/json", "svix-id": MSG_ID, "svix-timestamp": String(NOW), "svix-signature": signature },
      ...(method === "POST" ? { body } : {}),
    });

  const handle = (request: Request, layer: Layer.Layer<AppConfig | Orders | JudgmentQueue>) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const response = yield* handleAutumnWebhook(request);
      const isJson = response.headers.get("content-type")?.includes("json") ?? false;
      const body = isJson ? yield* Effect.promise(() => response.json() as Promise<Record<string, unknown>>) : null;
      return { status: response.status, body };
    }).pipe(Effect.provide(layer));

  it.effect("settles a pending order on a verified billing.updated", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment") });
      const result = yield* handle(signedRequest(event), h.layer);
      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.body, { ok: true, orderId: ORDER, status: "paid" });
      assert.deepStrictEqual(h.settled, [{ orderId: ORDER, customerId: VISITOR }]);
    }),
  );

  it.effect("accepts deliveries signed with any of several configured secrets (sandbox and production)", () =>
    Effect.gen(function* () {
      const other = "whsec_c2VjcmV0LXRoYXQtaXMtbm90LW91cnM=";
      for (const secrets of [`${other} ${SECRET}`, `${SECRET},${other}`, `  ${other}\n${SECRET}  `]) {
        const h = harness({ initial: Option.some("pending_payment"), secrets });
        const result = yield* handle(signedRequest(event), h.layer);
        assert.strictEqual(result.status, 200, secrets);
        assert.deepStrictEqual(h.settled, [{ orderId: ORDER, customerId: VISITOR }]);
      }
      const h = harness({ initial: Option.some("pending_payment"), secrets: `${other} ${other}` });
      assert.strictEqual((yield* handle(signedRequest(event), h.layer)).status, 401);
    }),
  );

  it.effect("rejects a bad signature with 401 and settles nothing", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment") });
      const forged = nodeSign("whsec_c2VjcmV0LXRoYXQtaXMtbm90LW91cnM=", MSG_ID, NOW, event);
      const result = yield* handle(signedRequest(event, forged), h.layer);
      assert.strictEqual(result.status, 401);
      assert.strictEqual(h.settled.length, 0);
    }),
  );

  it.effect("400s when the Svix headers are missing", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment") });
      const request = new Request("https://jevboard.test/api/autumn/webhook", { method: "POST", body: event });
      const result = yield* handle(request, h.layer);
      assert.strictEqual(result.status, 400);
      assert.strictEqual(h.settled.length, 0);
    }),
  );

  it.effect("is a 404 when no webhook secret is configured", () =>
    Effect.gen(function* () {
      const layer = Layer.mergeAll(
        autumnConfig(Option.none()),
        Layer.mock(Orders, {}),
        Layer.mock(JudgmentQueue, {}),
      );
      const response = yield* handleAutumnWebhook(signedRequest(event)).pipe(Effect.provide(layer));
      assert.strictEqual(response.status, 404);
    }),
  );

  it.effect("answers 2xx for well-signed events it ignores", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment") });
      const other = JSON.stringify({ type: "balances.limit_reached", data: { customer_id: `jev_${ORDER}` } });
      const result = yield* handle(signedRequest(other), h.layer);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.body?.["ok"], true);
      assert.strictEqual(h.settled.length, 0);
    }),
  );

  it.effect("answers 2xx for an unknown order", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.none() });
      const result = yield* handle(signedRequest(event), h.layer);
      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.body, { ok: true, ignored: "unknown order" });
      assert.strictEqual(h.settled.length, 0);
    }),
  );

  it.effect("does not re-settle an order that is already paid (redelivery)", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("judging") });
      const result = yield* handle(signedRequest(event), h.layer);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(h.settled.length, 0);
    }),
  );

  it.effect("503s when payment can't be confirmed yet, so Svix redelivers", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment"), settleFails: true });
      const result = yield* handle(signedRequest(event), h.layer);
      assert.strictEqual(result.status, 503);
      assert.strictEqual(h.settled.length, 1);
    }),
  );

  it.effect("405s anything but POST", () =>
    Effect.gen(function* () {
      const h = harness({ initial: Option.some("pending_payment") });
      const result = yield* handle(signedRequest(event, undefined, "GET"), h.layer);
      assert.strictEqual(result.status, 405);
    }),
  );
});
