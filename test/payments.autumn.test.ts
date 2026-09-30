import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Schedule } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { type CheckoutInput, Payments } from "~/.server/services/Payments";
import { type AutumnPaymentsOptions, layerWith } from "~/.server/services/payments/AutumnPayments";

// ---------------------------------------------------------------------------
// A fake Autumn API behind a fake HttpClient: records every request and
// answers from a per-test script.
// ---------------------------------------------------------------------------

interface Call {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

type Reply = { readonly status: number; readonly body?: unknown } | "network-error";

const fakeAutumn = (respond: (call: Call, previous: ReadonlyArray<Call>) => Reply) => {
  const calls: Array<Call> = [];
  const client = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      const call: Call = {
        method: request.method,
        path: url.pathname,
        headers: { ...request.headers },
        body: raw ? JSON.parse(raw) : undefined,
      };
      const reply = respond(call, [...calls]);
      calls.push(call);
      if (reply === "network-error") {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "connection reset" }),
          }),
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
            status: reply.status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    }),
  );
  return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const SECRET = "am_sk_test_Jev0000000000000000000000000000";
const ORDER = "oAbCdEfGhIjKlMnOpQrStUv";
const VISITOR = "cZyXwVuTsRqPoNmLkJiHgFe";
const CUSTOMER = `jev_${ORDER}`;

const options: AutumnPaymentsOptions = {
  secretKey: Redacted.make(SECRET),
  apiUrl: "https://api.useautumn.test/v1",
  apiVersion: "2.4.0",
  planId: "judgment",
  featureId: "judgment",
  // Same retry policy shape as production, without the waiting.
  retrySchedule: Schedule.recurs(3),
};

const checkoutInput: CheckoutInput = {
  orderId: ORDER,
  customerId: VISITOR,
  successUrl: `https://jevboard.test/judging/${ORDER}`,
  cancelUrl: `https://jevboard.test/?cancelled=${ORDER}`,
  description: "Jev judgment: acme.com",
};

const withPayments = <A, E>(
  fake: ReturnType<typeof fakeAutumn>,
  use: (payments: Payments["Service"]) => Effect.Effect<A, E>,
) => Effect.flatMap(Payments, use).pipe(Effect.provide(layerWith(options).pipe(Layer.provide(fake.layer))));

const customer = (fields: Record<string, unknown> = {}) => ({
  id: CUSTOMER,
  name: null,
  email: null,
  env: "sandbox",
  metadata: { visitor_id: VISITOR, order_id: ORDER },
  subscriptions: [],
  purchases: [],
  balances: {},
  flags: {},
  ...fields,
});

const paidCustomer = customer({
  purchases: [{ plan_id: "judgment", expires_at: null, started_at: 1790700042000, quantity: 1 }],
  balances: {
    judgment: { feature_id: "judgment", granted: 1, remaining: 1, usage: 0, unlimited: false, overage_allowed: false },
  },
});

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3";

const assertAutumnHeaders = (call: Call) => {
  assert.strictEqual(call.method, "POST");
  assert.strictEqual(call.headers["authorization"], `Bearer ${SECRET}`);
  assert.strictEqual(call.headers["x-api-version"], "2.4.0");
  assert.match(call.headers["content-type"] ?? "", /^application\/json/);
  assert.strictEqual(call.headers["accept"], "application/json");
};

// ---------------------------------------------------------------------------

describe("AutumnPayments.createCheckout", () => {
  it.effect("creates the order's customer, attaches the plan and redirects to Stripe Checkout", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get_or_create"
          ? { status: 200, body: customer() }
          : { status: 200, body: { customer_id: CUSTOMER, payment_url: STRIPE_URL } },
      );
      const result = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput));

      assert.deepStrictEqual(result, { _tag: "Redirect", url: STRIPE_URL });
      assert.deepStrictEqual(
        fake.calls.map((call) => call.path),
        ["/v1/customers.get_or_create", "/v1/billing.attach"],
      );
      for (const call of fake.calls) {
        assertAutumnHeaders(call);
        assert.isUndefined(call.headers["idempotency-key"]);
      }

      const [create, attach] = fake.calls;
      assert.deepStrictEqual(create?.body, {
        customer_id: CUSTOMER,
        metadata: { visitor_id: VISITOR, order_id: ORDER },
      });
      assert.deepStrictEqual(attach?.body, {
        customer_id: CUSTOMER,
        plan_id: "judgment",
        redirect_mode: "always",
        success_url: checkoutInput.successUrl,
        subscription_id: ORDER,
        metadata: { order_id: ORDER, visitor_id: VISITOR, description: "Jev judgment: acme.com" },
        checkout_session_params: {
          cancel_url: checkoutInput.cancelUrl,
          client_reference_id: ORDER,
          payment_method_types: ["card"],
          allow_promotion_codes: false,
          saved_payment_method_options: { payment_method_save: "disabled" },
          custom_text: { submit: { message: "Jev judgment: acme.com" } },
        },
      });
      assert.notProperty(attach?.body, "enable_plan_immediately");
    }),
  );

  it.effect("409 from billing.attach (order already purchased) is AlreadyPaid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get_or_create"
          ? { status: 200, body: customer() }
          : {
              status: 409,
              body: {
                message: `subscription_id '${ORDER}' is already in use for this customer`,
                code: "duplicate_subscription_id",
                env: "sandbox",
              },
            },
      );
      const result = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput));
      assert.deepStrictEqual(result, { _tag: "AlreadyPaid" });
      assert.strictEqual(fake.calls.length, 2);
    }),
  );

  it.effect("retries a 423 attach lock, then redirects", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call, previous) => {
        if (call.path === "/v1/customers.get_or_create") return { status: 200, body: customer() };
        const attempts = previous.filter((c) => c.path === "/v1/billing.attach").length;
        return attempts === 0
          ? {
              status: 423,
              body: { message: "Operation already in progress, try again in a few seconds", code: "lock_already_exists" },
            }
          : { status: 200, body: { customer_id: CUSTOMER, payment_url: STRIPE_URL } };
      });
      const result = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput));
      assert.deepStrictEqual(result, { _tag: "Redirect", url: STRIPE_URL });
      const attaches = fake.calls.filter((c) => c.path === "/v1/billing.attach");
      assert.strictEqual(attaches.length, 2);
      // Deterministic body: the retry is the same request, so Autumn reuses the session.
      assert.deepStrictEqual(attaches[0]?.body, attaches[1]?.body);
    }),
  );

  it.effect("a 423 'checkout just completed' that outlasts the retries is AlreadyPaid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get_or_create"
          ? { status: 200, body: customer() }
          : {
              status: 423,
              body: {
                message: "A checkout session for this customer was just completed and is still being processed",
                code: "lock_already_exists",
              },
            },
      );
      const result = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput));
      assert.deepStrictEqual(result, { _tag: "AlreadyPaid" });
      assert.strictEqual(fake.calls.filter((c) => c.path === "/v1/billing.attach").length, 4);
    }),
  );

  it.effect("an order whose customer already holds the credit is AlreadyPaid without a new checkout", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200, body: paidCustomer }));
      const result = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput));
      assert.deepStrictEqual(result, { _tag: "AlreadyPaid" });
      assert.deepStrictEqual(
        fake.calls.map((call) => call.path),
        ["/v1/customers.get_or_create"],
      );
    }),
  );

  it.effect("an Autumn rejection is a PaymentError carrying Autumn's code, without retrying", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get_or_create"
          ? { status: 200, body: customer() }
          : { status: 400, body: { message: "(Stripe Error) No such price", code: "stripe_error", env: "sandbox" } },
      );
      const error = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput)).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(error.status, 400);
      assert.include(error.message, "stripe_error");
      assert.include(error.message, "No such price");
      assert.strictEqual(fake.calls.filter((c) => c.path === "/v1/billing.attach").length, 1);
    }),
  );

  it.effect("never puts the secret key in an error message", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({
        status: 401,
        body: { message: `Invalid secret key: ${SECRET}`, code: "invalid_secret_key", env: "sandbox" },
      }));
      const error = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput)).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.include(error.message, "invalid_secret_key");
      assert.notInclude(error.message, SECRET);
      assert.notInclude(error.message, "Jev0000");
      assert.strictEqual(fake.calls.length, 1, "401 is not retried");
    }),
  );

  it.effect("gives up on a persistent 429 after the retries", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 429, body: { message: "Too many requests", code: "rate_limit_exceeded" } }));
      const error = yield* withPayments(fake, (payments) => payments.createCheckout(checkoutInput)).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(error.status, 429);
      assert.strictEqual(fake.calls.length, 4, "1 attempt + 3 retries");
    }),
  );

  it.effect("rejects order ids Autumn can't use as customer ids", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200, body: customer() }));
      const error = yield* withPayments(fake, (payments) =>
        payments.createCheckout({ ...checkoutInput, orderId: "../evil id" }),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(fake.calls.length, 0);
    }),
  );
});

describe("AutumnPayments.confirm", () => {
  const confirm = (fake: ReturnType<typeof fakeAutumn>) =>
    withPayments(fake, (payments) => payments.confirm({ orderId: ORDER, customerId: VISITOR }));

  it.effect("an unknown customer (404 customer_not_found) is unpaid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({
        status: 404,
        body: { message: `Customer ${CUSTOMER} not found`, code: "customer_not_found", env: "sandbox" },
      }));
      assert.strictEqual(yield* confirm(fake), "unpaid");
      assert.strictEqual(fake.calls.length, 1);
      assert.strictEqual(fake.calls[0]?.path, "/v1/customers.get");
      assert.deepStrictEqual(fake.calls[0]?.body, { customer_id: CUSTOMER });
      assertAutumnHeaders(fake.calls[0]!);
    }),
  );

  it.effect("no grant yet is unpaid and consumes nothing", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200, body: customer() }));
      assert.strictEqual(yield* confirm(fake), "unpaid");
      assert.strictEqual(fake.calls.length, 1);
    }),
  );

  it.effect("a zero balance (granted 0) is unpaid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({
        status: 200,
        body: customer({ balances: { judgment: { feature_id: "judgment", granted: 0, remaining: 0, usage: 0 } } }),
      }));
      assert.strictEqual(yield* confirm(fake), "unpaid");
      assert.strictEqual(fake.calls.length, 1);
    }),
  );

  it.effect("paid: consumes exactly one credit under an idempotency key", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: paidCustomer }
          : {
              status: 200,
              body: { customer_id: CUSTOMER, value: 1, balance: { feature_id: "judgment", granted: 1, remaining: 0 } },
            },
      );
      assert.strictEqual(yield* confirm(fake), "paid");
      assert.deepStrictEqual(
        fake.calls.map((call) => call.path),
        ["/v1/customers.get", "/v1/balances.track"],
      );
      const track = fake.calls[1]!;
      assertAutumnHeaders(track);
      assert.strictEqual(track.headers["idempotency-key"], `consume:${ORDER}`);
      assert.deepStrictEqual(track.body, {
        customer_id: CUSTOMER,
        feature_id: "judgment",
        value: 1,
        properties: { order_id: ORDER },
      });
    }),
  );

  it.effect("a purchase of the plan counts as paid even without a balance entry", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ purchases: [{ plan_id: "judgment", quantity: 1 }] }) }
          : { status: 200, body: {} },
      );
      assert.strictEqual(yield* confirm(fake), "paid");
    }),
  );

  it.effect("a repeated consume (409 duplicate_idempotency_key) is still paid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: paidCustomer }
          : { status: 409, body: { message: "Duplicate idempotency key", code: "duplicate_idempotency_key" } },
      );
      assert.strictEqual(yield* confirm(fake), "paid");
      assert.strictEqual(fake.calls.filter((c) => c.path === "/v1/balances.track").length, 1);
    }),
  );

  it.effect("a track accepted for replay (202) is paid", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get" ? { status: 200, body: paidCustomer } : { status: 202, body: { value: 1 } },
      );
      assert.strictEqual(yield* confirm(fake), "paid");
    }),
  );

  it.effect("fails closed on 5xx: PaymentError after retries, nothing consumed", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 500, body: { message: "Internal server error", code: "internal_error" } }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(error.status, 500);
      assert.strictEqual(fake.calls.length, 4);
      assert.isTrue(fake.calls.every((call) => call.path === "/v1/customers.get"));
    }),
  );

  it.effect("fails closed on network errors", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => "network-error");
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.isUndefined(error.status);
      assert.strictEqual(fake.calls.length, 4);
    }),
  );

  it.effect("recovers when a retry succeeds", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call, previous) => {
        if (call.path === "/v1/balances.track") return { status: 200, body: {} };
        return previous.length === 0 ? { status: 503, body: { message: "Service unavailable" } } : { status: 200, body: paidCustomer };
      });
      assert.strictEqual(yield* confirm(fake), "paid");
    }),
  );

  it.effect("a 202 from customers.get is not proof of payment", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 202, body: paidCustomer }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(fake.calls.length, 1);
    }),
  );

  it.effect("an unrecognisable balance fails closed", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200, body: customer({ balances: { judgment: { granted: "lots" } } }) }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(fake.calls.length, 1);
    }),
  );

  it.effect("a non-JSON 200 fails closed", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200 }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
    }),
  );

  it.effect("a record for a different customer fails closed", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 200, body: { ...paidCustomer, id: "jev_somebodyElse" } }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(fake.calls.length, 1);
    }),
  );

  it.effect("a 404 that isn't customer_not_found is an error, not 'unpaid'", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn(() => ({ status: 404, body: { message: "Not Found" } }));
      const error = yield* confirm(fake).pipe(Effect.flip);
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(error.status, 404);
    }),
  );

  it.effect("a failed consume after proven payment still reports paid (per-order customer, no double spend)", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get" ? { status: 200, body: paidCustomer } : { status: 500, body: { message: "boom" } },
      );
      assert.strictEqual(yield* confirm(fake), "paid");
      // Every retry reuses the same key, so Autumn applies the consumption at most once.
      const tracks = fake.calls.filter((c) => c.path === "/v1/balances.track");
      assert.strictEqual(tracks.length, 4);
      assert.isTrue(tracks.every((c) => c.headers["idempotency-key"] === `consume:${ORDER}`));
    }),
  );
});

describe("AutumnPayments.refund", () => {
  const INVOICE = "in_1ULNh1G2wleIbAUgmCqcrieo";
  const REFUND_PATH = `/v1/customers/${CUSTOMER}/invoices/${INVOICE}/refund`;
  const refund = (fake: ReturnType<typeof fakeAutumn>) =>
    withPayments(fake, (payments) => payments.refund({ orderId: ORDER, reason: "Your site kept timing out." }));

  const invoice = (fields: Record<string, unknown> = {}) => ({
    plan_ids: ["judgment"],
    stripe_id: INVOICE,
    processor_type: "stripe",
    status: "paid",
    total: 5,
    currency: "usd",
    created_at: 1790775427000,
    ...fields,
  });

  it.effect("refunds the plan's paid invoice in full under an idempotency key", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ ...paidCustomer, invoices: [invoice()] }) }
          : { status: 200, body: { success: true } },
      );
      assert.strictEqual(yield* refund(fake), "refunded");
      assert.deepStrictEqual(
        fake.calls.map((call) => call.path),
        ["/v1/customers.get", REFUND_PATH],
      );
      assert.deepStrictEqual(fake.calls[0]!.body, { customer_id: CUSTOMER, expand: ["invoices"] });
      const call = fake.calls[1]!;
      assertAutumnHeaders(call);
      assert.strictEqual(call.headers["idempotency-key"], `refund:${ORDER}:${INVOICE}`);
      assert.deepStrictEqual(call.body, { mode: "full", reason: "Your site kept timing out." });
    }),
  );

  it.effect("a repeated refund (409 duplicate_idempotency_key) is refunded, not an error", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ invoices: [invoice()] }) }
          : { status: 409, body: { message: "Duplicate idempotency key", code: "duplicate_idempotency_key" } },
      );
      assert.strictEqual(yield* refund(fake), "refunded");
    }),
  );

  it.effect("a charge Stripe says is already fully refunded counts as refunded", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ invoices: [invoice()] }) }
          : { status: 400, body: { message: "This charge has already been fully refunded", code: "invalid_request" } },
      );
      assert.strictEqual(yield* refund(fake), "refunded");
    }),
  );

  it.effect("no paid invoice for the plan, or no customer at all, is nothing to refund", () =>
    Effect.gen(function* () {
      const unpaid = fakeAutumn(() => ({
        status: 200,
        body: customer({ invoices: [invoice({ status: "open" }), invoice({ plan_ids: ["other"] })] }),
      }));
      assert.strictEqual(yield* refund(unpaid), "nothing_to_refund");
      assert.deepStrictEqual(
        unpaid.calls.map((call) => call.path),
        ["/v1/customers.get"],
      );

      const missing = fakeAutumn(() => ({
        status: 404,
        body: { message: "Customer not found", code: "customer_not_found" },
      }));
      assert.strictEqual(yield* refund(missing), "nothing_to_refund");
    }),
  );

  it.effect("a refund Stripe rejects is a PaymentError (the cron tries again later)", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ invoices: [invoice()] }) }
          : { status: 400, body: { message: "This charge is not eligible for a refund", code: "invalid_request" } },
      );
      const error = yield* Effect.flip(refund(fake));
      assert.strictEqual(error._tag, "PaymentError");
      assert.strictEqual(error.status, 400);
      assert.notInclude(error.message, SECRET);
    }),
  );

  it.effect("retries a 5xx refund with the same idempotency key", () =>
    Effect.gen(function* () {
      const fake = fakeAutumn((call, previous) =>
        call.path === "/v1/customers.get"
          ? { status: 200, body: customer({ invoices: [invoice()] }) }
          : previous.some((p) => p.path === REFUND_PATH)
            ? { status: 200, body: { success: true } }
            : { status: 503, body: { message: "Busy" } },
      );
      assert.strictEqual(yield* refund(fake), "refunded");
      const refunds = fake.calls.filter((call) => call.path === REFUND_PATH);
      assert.strictEqual(refunds.length, 2);
      assert.isTrue(refunds.every((call) => call.headers["idempotency-key"] === `refund:${ORDER}:${INVOICE}`));
    }),
  );
});
