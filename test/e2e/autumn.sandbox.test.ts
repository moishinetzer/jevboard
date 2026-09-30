import { readFileSync } from "node:fs";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient, HttpClient, type HttpClientRequest } from "effect/http";
import { makeCustomerId, makeOrderId } from "~/.server/domain/ids";
import { type CheckoutInput, Payments } from "~/.server/services/Payments";
import { makeAutumnClient, scrubSecrets } from "~/.server/services/payments/AutumnClient";
import { type AutumnPaymentsOptions, autumnCustomerId, layerWith } from "~/.server/services/payments/AutumnPayments";
import { decideWebhook, signSvix, verifySvixSignature } from "~/.server/services/payments/webhook";

/**
 * Live contract test: the app's real Autumn payments code (AutumnPayments over
 * FetchHttpClient, configured like production) against the Autumn SANDBOX,
 * API 2.4.0. Covers everything on the docs/payments.md sandbox checklist that
 * doesn't need a completed Stripe payment. Every customer it creates is
 * deleted in afterAll.
 *
 *   set -a; . ~/jevboard.secrets.env; set +a; pnpm test:e2e test/e2e/autumn.sandbox.test.ts
 *
 * Skipped unless AUTUMN_SECRET_KEY is a sandbox key (`am_sk_test_…`). Live keys are refused.
 *
 * The checks that need a real payment run against an order someone paid by hand:
 *   1. Add AUTUMN_MANUAL_CHECKOUT=1 to the command above. It prints an order id and a
 *      Stripe Checkout URL, and keeps that customer.
 *   2. Pay it with 4242 4242 4242 4242, any future expiry, any CVC, any postcode.
 *   3. Run again with AUTUMN_PAID_ORDER_ID=<order id>.
 * With a webhook endpoint set up (docs/payments.md, "Webhook"), also set AUTUMN_WEBHOOK_SECRET,
 * and AUTUMN_WEBHOOK_PAYLOAD=<file holding the raw body of the billing.updated delivery for that payment>.
 */

const configuredKey = process.env["AUTUMN_SECRET_KEY"];
const SANDBOX_KEY = configuredKey?.startsWith("am_sk_test_") ? configuredKey : undefined;
if (configuredKey && !SANDBOX_KEY) {
  console.warn("AUTUMN_SECRET_KEY is not a sandbox key (am_sk_test_…): the Autumn sandbox tests are skipped.");
}
const PAID_ORDER_ID = process.env["AUTUMN_PAID_ORDER_ID"];
const MANUAL_CHECKOUT = process.env["AUTUMN_MANUAL_CHECKOUT"] === "1";
const WEBHOOK_SECRET = process.env["AUTUMN_WEBHOOK_SECRET"];
const WEBHOOK_PAYLOAD = process.env["AUTUMN_WEBHOOK_PAYLOAD"];

const PUBLIC_URL = "https://jevboard.example";

/** As in production (AppConfig defaults), with the production retry policy and timeout. */
const options: AutumnPaymentsOptions = {
  secretKey: Redacted.make(SANDBOX_KEY ?? ""),
  apiUrl: "https://api.useautumn.com/v1",
  apiVersion: "2.4.0",
  planId: "judgment",
  featureId: "judgment",
};

// ---------------------------------------------------------------------------
// The real FetchHttpClient, recording what the app sends (never the key).
// ---------------------------------------------------------------------------

interface Call {
  /** e.g. "billing.attach" */
  readonly endpoint: string;
  readonly status: number;
  /** Request headers without `authorization`. */
  readonly headers: Readonly<Record<string, string>>;
  /** The request carried `Authorization: Bearer am_sk_test_…`. */
  readonly sandboxBearer: boolean;
  readonly body: unknown;
}

const toCall = (request: HttpClientRequest.HttpClientRequest, status: number): Call => {
  const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
  return {
    endpoint: new URL(request.url).pathname.replace(/^\/v1\//, ""),
    status,
    headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => name !== "authorization")),
    sandboxBearer: request.headers["authorization"]?.startsWith("Bearer am_sk_test_") ?? false,
    body: raw ? JSON.parse(raw) : undefined,
  };
};

const recordingHttp = (calls: Array<Call>) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(
      HttpClient.HttpClient,
      HttpClient.tap((response) => Effect.sync(() => void calls.push(toCall(response.request, response.status)))),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** Runs `use` against the production Payments service; returns its result and the Autumn calls it made. */
const withPayments = <A, E>(use: (payments: Payments["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const calls: Array<Call> = [];
    const result = yield* Effect.flatMap(Payments, use).pipe(
      Effect.provide(layerWith(options).pipe(Layer.provide(recordingHttp(calls)))),
    );
    return { result, calls };
  });

/** Raw `AutumnClient.post` (fails with AutumnError on non-2xx), to see exact response shapes. */
const post = (endpoint: string, body: unknown, callOptions?: { readonly idempotencyKey?: string }) =>
  Effect.flatMap(HttpClient.HttpClient, (http) => makeAutumnClient(http, options).post(endpoint, body, callOptions)).pipe(
    Effect.provide(FetchHttpClient.layer),
  );

/** The AutumnError of a call that must fail (a success fails the test with the reply). */
const postError = (endpoint: string, body: unknown, callOptions?: { readonly idempotencyKey?: string }) =>
  Effect.flip(post(endpoint, body, callOptions));

/** A 2xx body as a plain record, for assertions. */
const record = (body: unknown): Record<string, unknown> => {
  assert.isObject(body);
  return body as Record<string, unknown>;
};

/** Logs a response shape one field per line, keys scrubbed (scrubSecrets also caps each line at 500 chars). */
const show = (label: string, value: Record<string, unknown>) =>
  console.log(
    [label, ...Object.entries(value).map(([field, data]) => `  ${field}: ${scrubSecrets(JSON.stringify(data) ?? "")}`)].join(
      "\n",
    ),
  );

// ---------------------------------------------------------------------------
// Orders (fresh ids in the app's format) and cleanup
// ---------------------------------------------------------------------------

/** Autumn customers this run may have created; all deleted in afterAll. */
const created = new Set<string>();

const newOrder = () => {
  const orderId = makeOrderId();
  const visitorId = makeCustomerId();
  created.add(autumnCustomerId(orderId));
  const input: CheckoutInput = {
    orderId,
    customerId: visitorId,
    // Built like app/.server/flows/submit.ts, with PUBLIC_URL as the origin.
    successUrl: `${PUBLIC_URL}/judging/${orderId}`,
    cancelUrl: `${PUBLIC_URL}/?cancelled=${orderId}`,
    description: "Jev judgment: example.com",
  };
  return { orderId, visitorId, customerId: autumnCustomerId(orderId), input };
};

const deleteCustomer = (customerId: string) =>
  post("customers.delete", { customer_id: customerId, delete_in_stripe: true }).pipe(
    Effect.asVoid,
    Effect.catchTag("AutumnError", (error) => (error.code === "customer_not_found" ? Effect.void : Effect.fail(error))),
  );

/** The attach body the app sends for `order` (see AutumnPayments.createCheckout). */
const expectedAttachBody = (order: ReturnType<typeof newOrder>) => ({
  customer_id: order.customerId,
  plan_id: "judgment",
  redirect_mode: "always",
  success_url: `${PUBLIC_URL}/judging/${order.orderId}`,
  subscription_id: order.orderId,
  metadata: { order_id: order.orderId, visitor_id: order.visitorId, description: "Jev judgment: example.com" },
  checkout_session_params: {
    cancel_url: `${PUBLIC_URL}/?cancelled=${order.orderId}`,
    client_reference_id: order.orderId,
    payment_method_types: ["card"],
    allow_promotion_codes: false,
    saved_payment_method_options: { payment_method_save: "disabled" },
    custom_text: { submit: { message: "Jev judgment: example.com" } },
  },
});

// ---------------------------------------------------------------------------

describe.skipIf(!SANDBOX_KEY)("Autumn sandbox contract (API 2.4.0, no payment)", () => {
  afterAll(() => Effect.runPromise(Effect.forEach(created, deleteCustomer, { discard: true })));

  it.live("checkout for a new order redirects to Stripe Checkout with the order's return URLs", () =>
    Effect.gen(function* () {
      const order = newOrder();
      const { result, calls } = yield* withPayments((payments) => payments.createCheckout(order.input));

      assert.strictEqual(result._tag, "Redirect");
      const url = new URL(result._tag === "Redirect" ? result.url : "");
      assert.strictEqual(url.origin, "https://checkout.stripe.com");
      assert.match(url.pathname, /^\/c\/pay\/cs_test_[A-Za-z0-9]+$/, "a test-mode Checkout Session");

      assert.deepStrictEqual(
        calls.map((call) => [call.endpoint, call.status]),
        [
          ["customers.get_or_create", 200],
          ["billing.attach", 200],
        ],
      );
      for (const call of calls) {
        assert.isTrue(call.sandboxBearer);
        assert.strictEqual(call.headers["x-api-version"], "2.4.0");
        assert.isUndefined(call.headers["idempotency-key"]);
      }
      assert.deepStrictEqual(calls[0]?.body, {
        customer_id: order.customerId,
        metadata: { visitor_id: order.visitorId, order_id: order.orderId },
      });
      // Autumn answered 200 to exactly this body: success_url -> /judging/<orderId>,
      // cancel_url -> /?cancelled=<orderId>. The response is only { customer_id, payment_url },
      // so what Stripe stored can't be read back without Stripe's key.
      assert.deepStrictEqual(calls[1]?.body, expectedAttachBody(order));

      // The Checkout page is live.
      const page = yield* Effect.promise(() => fetch(url, { redirect: "manual" }));
      assert.strictEqual(page.status, 200);
    }),
  );

  it.live("a repeated checkout for the same order reuses the same Stripe session", () =>
    Effect.gen(function* () {
      const order = newOrder();
      const { result, calls } = yield* withPayments((payments) =>
        Effect.all([payments.createCheckout(order.input), payments.createCheckout(order.input)]),
      );
      assert.strictEqual(result[0]._tag, "Redirect");
      // Autumn keys the pending session on the attach body, which is deterministic per order.
      assert.deepStrictEqual(result[1], result[0]);
      const attaches = calls.filter((call) => call.endpoint === "billing.attach");
      assert.strictEqual(attaches.length, 2);
      assert.deepStrictEqual(attaches[1]?.body, attaches[0]?.body);
    }),
  );

  it.live("customers.get before payment: no balance, no purchase, metadata holds the visitor and order ids", () =>
    Effect.gen(function* () {
      const order = newOrder();
      yield* withPayments((payments) => payments.createCheckout(order.input));

      const reply = yield* post("customers.get", { customer_id: order.customerId });
      assert.strictEqual(reply.status, 200);
      const customer = record(reply.body);
      show("customers.get before payment", customer);
      // Observed: { id, name: null, email: null, created_at, fingerprint: null, stripe_id: null, env: "sandbox",
      //   metadata: { order_id, visitor_id }, send_email_receipts: false, billing_controls: {},
      //   subscriptions: [], purchases: [], licenses: [], balances: {}, flags: {}, config: {} }
      assert.strictEqual(customer["id"], order.customerId);
      assert.strictEqual(customer["env"], "sandbox");
      assert.deepStrictEqual(customer["metadata"], { order_id: order.orderId, visitor_id: order.visitorId });
      // `balances` is {} (no `judgment` entry with granted 0). The code accepts either.
      const balances = record(customer["balances"]);
      const judgment = balances["judgment"];
      assert.isTrue(judgment === undefined || record(judgment)["granted"] === 0, "no judgment granted yet");
      // The pending checkout is NOT listed here, which matters: isPaid treats any listed
      // purchase of the plan as paid, whatever its status.
      assert.deepStrictEqual(customer["purchases"], []);
      assert.deepStrictEqual(customer["subscriptions"], []);
    }),
  );

  it.live("confirm before payment is unpaid, reads only customers.get and consumes nothing", () =>
    Effect.gen(function* () {
      const order = newOrder();
      yield* withPayments((payments) => payments.createCheckout(order.input));

      const { result, calls } = yield* withPayments((payments) =>
        payments.confirm({ orderId: order.orderId, customerId: order.visitorId }),
      );
      assert.strictEqual(result, "unpaid");
      assert.deepStrictEqual(
        calls.map((call) => [call.endpoint, call.status]),
        [["customers.get", 200]],
      );
      const after = record((yield* post("customers.get", { customer_id: order.customerId })).body);
      assert.deepStrictEqual(after["balances"], {});
    }),
  );

  it.live("confirm for an order that never reached checkout is unpaid (404 customer_not_found)", () =>
    Effect.gen(function* () {
      const order = newOrder();
      const { result, calls } = yield* withPayments((payments) =>
        payments.confirm({ orderId: order.orderId, customerId: order.visitorId }),
      );
      assert.strictEqual(result, "unpaid");
      assert.deepStrictEqual(
        calls.map((call) => [call.endpoint, call.status]),
        [["customers.get", 404]],
      );
      const error = yield* postError("customers.get", { customer_id: order.customerId });
      assert.strictEqual(error.status, 404);
      assert.strictEqual(error.code, "customer_not_found");
    }),
  );

  it.live("billing.attach accepts subscription_id on the one-off plan: the pending purchase is keyed by the order id", () =>
    Effect.gen(function* () {
      const order = newOrder();
      yield* withPayments((payments) =>
        Effect.all([payments.createCheckout(order.input), payments.createCheckout(order.input)]),
      );
      const reply = yield* post("purchases.list", {
        customer_id: order.customerId,
        statuses: ["active", "scheduled", "expired"],
      });
      const list = record(reply.body)["list"];
      show("purchases.list before payment", { list });
      // Observed: [{ id: <orderId>, plan_id: "judgment", status: "scheduled", expires_at: null, started_at,
      //   quantity: 1, scope: "customer", customer_id, entity_id: null, created_at }]
      // One pending purchase even after two checkouts. (An attach with a *different* body for the same
      // subscription_id expires it and starts a new session and a new "scheduled" purchase.)
      assert.isArray(list);
      assert.strictEqual((list as ReadonlyArray<unknown>).length, 1);
      const purchase = record((list as ReadonlyArray<unknown>)[0]);
      assert.strictEqual(purchase["id"], order.orderId);
      assert.strictEqual(purchase["plan_id"], "judgment");
      assert.strictEqual(purchase["status"], "scheduled");
    }),
  );

  it.live("checkout_session_params are passed on to Stripe", () =>
    Effect.gen(function* () {
      // The app's own params were accepted with a 200 in the first test. Here an unknown key is
      // added: Stripe itself rejects it, so Autumn forwards the object to Stripe's session create.
      const order = newOrder();
      yield* post("customers.get_or_create", { customer_id: order.customerId, metadata: { order_id: order.orderId } });
      const body = expectedAttachBody(order);
      const error = yield* postError("billing.attach", {
        ...body,
        checkout_session_params: { ...body.checkout_session_params, jevboard_probe: "x" },
      });
      assert.strictEqual(error.status, 400);
      assert.strictEqual(error.code, "stripe_error");
      assert.include(error.message, "(Stripe Error) Received unknown parameter: jevboard_probe");
    }),
  );

  it.live("a repeated balances.track with the same Idempotency-Key is 409 duplicate_idempotency_key", () =>
    Effect.gen(function* () {
      // Checked on an unpaid throwaway customer (nothing to deduct), with the app's exact body and key.
      const order = newOrder();
      yield* post("customers.get_or_create", { customer_id: order.customerId, metadata: { order_id: order.orderId } });
      const track = {
        customer_id: order.customerId,
        feature_id: "judgment",
        value: 1,
        properties: { order_id: order.orderId },
      };
      const key = { idempotencyKey: `consume:${order.orderId}` };
      const first = yield* post("balances.track", track, key);
      assert.strictEqual(first.status, 200);
      // Observed: { customer_id, value: 1, balance: null, deductions: [] }
      assert.deepStrictEqual(first.body, { customer_id: order.customerId, value: 1, balance: null, deductions: [] });
      const repeat = yield* postError("balances.track", track, key);
      assert.strictEqual(repeat.status, 409);
      assert.strictEqual(repeat.code, "duplicate_idempotency_key");
    }),
  );

  it.live("customers.delete removes a customer (the cleanup this file relies on)", () =>
    Effect.gen(function* () {
      const order = newOrder();
      yield* withPayments((payments) => payments.createCheckout(order.input));
      const deleted = yield* post("customers.delete", { customer_id: order.customerId, delete_in_stripe: true });
      assert.deepStrictEqual(deleted.body, { success: true });
      const error = yield* postError("customers.get", { customer_id: order.customerId });
      assert.strictEqual(error.code, "customer_not_found");
      const { result } = yield* withPayments((payments) =>
        payments.confirm({ orderId: order.orderId, customerId: order.visitorId }),
      );
      assert.strictEqual(result, "unpaid");
    }),
  );

  it.live("a bad key is a 401 whose error never contains the key", () =>
    Effect.gen(function* () {
      const bogus = "am_sk_test_JevboardE2eNotARealKey0000000000";
      const error = yield* Effect.flatMap(HttpClient.HttpClient, (http) =>
        makeAutumnClient(http, { ...options, secretKey: Redacted.make(bogus) }).post("customers.get", {
          customer_id: "jev_probe",
        }),
      ).pipe(Effect.provide(FetchHttpClient.layer), Effect.flip);
      assert.strictEqual(error.status, 401);
      assert.notInclude(error.message, bogus);
      assert.notInclude(error.message, "JevboardE2e");
    }),
  );

  it.live.runIf(WEBHOOK_SECRET)("the webhook signing secret has the whsec_ format and signs/verifies", () =>
    Effect.gen(function* () {
      const secret = WEBHOOK_SECRET ?? "";
      assert.isTrue(/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret), "AUTUMN_WEBHOOK_SECRET is whsec_<base64>");
      const body = JSON.stringify({ type: "billing.updated", data: { customer_id: "jev_probe" } });
      const signature = yield* signSvix(secret, "msg_probe", 1_790_000_000, body);
      const verified = yield* verifySvixSignature({
        secret,
        headers: { id: "msg_probe", timestamp: "1790000000", signature },
        body,
        nowSeconds: 1_790_000_000,
      });
      assert.deepStrictEqual(verified, { ok: true });
    }),
  );

  it.live.runIf(MANUAL_CHECKOUT)("starts a checkout to pay by hand (kept, not deleted)", () =>
    Effect.gen(function* () {
      const order = newOrder();
      created.delete(order.customerId);
      const { result } = yield* withPayments((payments) => payments.createCheckout(order.input));
      assert.strictEqual(result._tag, "Redirect");
      console.log(
        `Pay with 4242 4242 4242 4242, then run with AUTUMN_PAID_ORDER_ID=${order.orderId}\n` +
          `${result._tag === "Redirect" ? result.url : ""}`,
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// Needs a manual payment (AUTUMN_PAID_ORDER_ID, see the top of the file).
// ---------------------------------------------------------------------------

describe.skipIf(!SANDBOX_KEY || !PAID_ORDER_ID)("Autumn sandbox contract, after a manual payment", () => {
  const orderId = PAID_ORDER_ID ?? "";
  const customerId = autumnCustomerId(orderId);
  const getCustomer = Effect.map(post("customers.get", { customer_id: customerId }), (reply) => {
    assert.strictEqual(reply.status, 200);
    return record(reply.body);
  });

  it.live("customers.get shows granted 1 and a purchase of the judgment plan", () =>
    Effect.gen(function* () {
      const customer = yield* getCustomer;
      show("customers.get after payment", customer);
      // Observed on a paid and consumed sandbox order (2026-09-30):
      //   purchases: [{ plan_id: "judgment", expires_at: null, started_at, quantity: 1, scope: "customer" }]
      //     (no id or status here, unlike purchases.list)
      //   balances.judgment: { feature_id: "judgment", granted: 1, remaining: 0, usage: 1, unlimited: false,
      //     overage_allowed: false, max_purchase: null, next_reset_at: null, breakdown: [...] }
      const balance = record(record(customer["balances"])["judgment"]);
      assert.strictEqual(balance["granted"], 1);
      const purchases = customer["purchases"];
      assert.isArray(purchases);
      assert.isTrue(
        (purchases as ReadonlyArray<unknown>).some((item) => record(item)["plan_id"] === "judgment"),
        "a purchases[] entry for judgment",
      );
    }),
  );

  it.live("confirm is paid, repeatably, and consumes once under consume:<orderId>", () =>
    Effect.gen(function* () {
      const customer = yield* getCustomer;
      const visitorId = String(record(customer["metadata"])["visitor_id"]);
      const { result, calls } = yield* withPayments((payments) =>
        Effect.all([payments.confirm({ orderId, customerId: visitorId }), payments.confirm({ orderId, customerId: visitorId })]),
      );
      assert.deepStrictEqual(result, ["paid", "paid"]);
      const tracks = calls.filter((call) => call.endpoint === "balances.track");
      assert.strictEqual(tracks.length, 2);
      for (const track of tracks) assert.strictEqual(track.headers["idempotency-key"], `consume:${orderId}`);
      // The first may be the first consumption (200) or a repeat (the judging page already consumed).
      assert.oneOf(tracks[0]?.status, [200, 409]);
      assert.strictEqual(tracks[1]?.status, 409, "a repeated balances.track with the same Idempotency-Key is 409");

      // isPaid must stay true after consumption: `granted` stays 1 (or the purchase stays listed).
      const after = yield* getCustomer;
      show("balance after consumption", record(record(after["balances"])["judgment"]));
      assert.strictEqual(record(record(after["balances"])["judgment"])["granted"], 1);
    }),
  );

  it.live("a second attach for the paid order is 409 duplicate_subscription_id, and checkout says AlreadyPaid", () =>
    Effect.gen(function* () {
      const customer = yield* getCustomer;
      const visitorId = String(record(customer["metadata"])["visitor_id"]);
      const error = yield* postError("billing.attach", {
        customer_id: customerId,
        plan_id: "judgment",
        redirect_mode: "always",
        success_url: `${PUBLIC_URL}/judging/${orderId}`,
        subscription_id: orderId,
      });
      assert.strictEqual(error.status, 409);
      assert.strictEqual(error.code, "duplicate_subscription_id");

      const { result, calls } = yield* withPayments((payments) =>
        payments.createCheckout({
          orderId,
          customerId: visitorId,
          successUrl: `${PUBLIC_URL}/judging/${orderId}`,
          cancelUrl: `${PUBLIC_URL}/?cancelled=${orderId}`,
          description: "Jev judgment: example.com",
        }),
      );
      assert.deepStrictEqual(result, { _tag: "AlreadyPaid" });
      assert.deepStrictEqual(
        calls.map((call) => call.endpoint),
        ["customers.get_or_create"],
      );
    }),
  );
});

describe.skipIf(!WEBHOOK_PAYLOAD)("Autumn billing.updated webhook payload (captured after a manual payment)", () => {
  it("has { type, data: { customer_id, plan_changes: [{ action: 'activated' }] } } and settles the order", () => {
    const payload: unknown = JSON.parse(readFileSync(WEBHOOK_PAYLOAD ?? "", "utf8"));
    const envelope = record(payload);
    assert.strictEqual(envelope["type"], "billing.updated");
    const data = record(envelope["data"]);
    assert.match(String(data["customer_id"]), /^jev_o[A-Za-z0-9]+$/);
    const changes = data["plan_changes"];
    assert.isArray(changes);
    assert.isTrue((changes as ReadonlyArray<unknown>).some((change) => record(change)["action"] === "activated"));

    const decision = decideWebhook(payload);
    assert.strictEqual(decision._tag, "Settle");
    if (PAID_ORDER_ID && decision._tag === "Settle") assert.strictEqual(decision.orderId, PAID_ORDER_ID);
  });
});
