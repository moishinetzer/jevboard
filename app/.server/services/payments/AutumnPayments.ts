import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { AppConfig } from "../../config";
import { PaymentError } from "../../domain/errors";
import { type CheckoutInput, type CheckoutResult, Payments } from "../Payments";
import { type AutumnClientOptions, AutumnError, decodeReply, makeAutumnClient } from "./AutumnClient";

/**
 * Real $5 payments through Autumn (useautumn.com) — see docs/payments.md.
 *
 * One Autumn customer per order (`jev_<orderId>`): the plan is a one-off $5
 * purchase granting one unit of the consumable `judgment` feature, so "this
 * order is paid" is simply "this order's customer was granted a judgment".
 * Orders can't interfere with each other's checkout sessions or credits.
 *
 *   createCheckout: customers.get_or_create → billing.attach(redirect_mode: "always") → Stripe Checkout URL
 *   confirm:        customers.get (HTTP 200 + granted >= 1) → balances.track(Idempotency-Key: consume:<orderId>)
 *
 * `confirm` fails closed: only a 200 from `customers.get` showing the grant
 * counts as paid. Anything unexpected is a `PaymentError`, never "paid".
 */

export interface AutumnPaymentsOptions extends AutumnClientOptions {
  /** One-off $5 plan that grants one judgment credit. */
  readonly planId: string;
  /** Consumable feature the plan grants. */
  readonly featureId: string;
}

const CUSTOMER_PREFIX = "jev_";
/** Our order ids are "o" + base62; Autumn customer ids allow [A-Za-z0-9_:-]. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The Autumn customer that owns exactly one order. */
export const autumnCustomerId = (orderId: string): string => `${CUSTOMER_PREFIX}${orderId}`;

/** Inverse of `autumnCustomerId`; None for customers that aren't Jevboard orders. */
export const orderIdFromAutumnCustomer = (customerId: string): Option.Option<string> => {
  if (!customerId.startsWith(CUSTOMER_PREFIX)) return Option.none();
  const orderId = customerId.slice(CUSTOMER_PREFIX.length);
  return ORDER_ID.test(orderId) ? Option.some(orderId) : Option.none();
};

const customerIdFor = (orderId: string): Effect.Effect<string, PaymentError> =>
  ORDER_ID.test(orderId)
    ? Effect.succeed(autumnCustomerId(orderId))
    : Effect.fail(new PaymentError({ message: "Invalid order id for payment." }));

// Response shapes: decode only the fields we read, leniently where the spec
// is unverified. Unknown extra fields are ignored.

/** `Customer` from customers.get / customers.get_or_create. */
const CustomerBody = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  balances: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  purchases: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
});
type CustomerBody = typeof CustomerBody.Type;
const Balance = Schema.Struct({ granted: Schema.Finite });
const Purchase = Schema.Struct({ plan_id: Schema.String });
const decodePurchase = Schema.decodeUnknownOption(Purchase);

/** billing.attach response. */
const AttachBody = Schema.Struct({
  payment_url: Schema.optional(Schema.NullOr(Schema.String)),
  invoice: Schema.optional(Schema.Unknown),
  required_action: Schema.optional(Schema.Unknown),
});
const InvoiceStatus = Schema.Struct({ status: Schema.String });
const RequiredActionCode = Schema.Struct({ code: Schema.String });

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Logs the Autumn failure (code + message, never the key) and converts it to the contract's error. */
const toPaymentError = (operation: string) => (error: AutumnError) =>
  Effect.logWarning(`Autumn ${operation} failed`, {
    endpoint: error.endpoint,
    status: error.status,
    code: error.code,
    message: error.message,
  }).pipe(
    Effect.andThen(
      Effect.fail(
        new PaymentError({
          message: `Payment provider error (${error.endpoint}${error.status === undefined ? "" : ` HTTP ${error.status}`}${error.code ? ` ${error.code}` : ""}): ${error.message}`,
          ...(error.status === undefined ? {} : { status: error.status }),
        }),
      ),
    ),
  );

/** Builds the Autumn-backed `Payments` service on top of any `HttpClient`. */
export const makeAutumnPayments = Effect.fnUntraced(function* (options: AutumnPaymentsOptions) {
  const autumn = makeAutumnClient(yield* HttpClient.HttpClient, options);

  /**
   * Has this order's customer been granted its judgment? True when the
   * feature balance shows `granted >= 1` or a purchase of the plan is listed
   * (`granted` stays 1 after we consume, so this is stable and repeatable).
   * A present-but-unrecognisable balance is an error, not "unpaid".
   */
  const isPaid = (customer: CustomerBody, endpoint: string): Effect.Effect<boolean, AutumnError> =>
    Effect.gen(function* () {
      const balance = customer.balances?.[options.featureId];
      if (balance !== undefined && balance !== null) {
        const decoded = yield* decodeReply(Balance, endpoint)({ status: 200, body: balance });
        if (decoded.granted >= 1) return true;
      }
      return (customer.purchases ?? []).some((item) =>
        Option.exists(decodePurchase(item), (purchase) => purchase.plan_id === options.planId),
      );
    });

  const createCheckout = Effect.fn("AutumnPayments.createCheckout")(
    function* (input: CheckoutInput) {
      const customerId = yield* customerIdFor(input.orderId);
      yield* Effect.annotateCurrentSpan({ "order.id": input.orderId, "autumn.customer": customerId });

      // Autumn requires the customer to exist before attach. Idempotent.
      const created = yield* autumn.post("customers.get_or_create", {
        customer_id: customerId,
        metadata: { visitor_id: input.customerId, order_id: input.orderId },
      });

      // A repeated checkout for an order that was already paid must not sell it twice.
      const existing = yield* Effect.option(
        Effect.flatMap(decodeReply(CustomerBody, "customers.get_or_create")(created), (customer) =>
          isPaid(customer, "customers.get_or_create"),
        ),
      );
      if (Option.getOrElse(existing, () => false)) {
        return { _tag: "AlreadyPaid" } satisfies CheckoutResult;
      }

      // Keep this body deterministic per order: Autumn hashes it, and an
      // identical attach returns the same pending Stripe session instead of a new one.
      const description = truncate(input.description.trim(), 450);
      const attachBody = {
        customer_id: customerId,
        plan_id: options.planId,
        // "if_required" (the default) would charge a saved card with no checkout page.
        redirect_mode: "always",
        success_url: input.successUrl,
        // Tags the purchase; a second paid attach for this order answers 409.
        subscription_id: input.orderId,
        metadata: {
          order_id: input.orderId,
          visitor_id: input.customerId,
          ...(description ? { description } : {}),
        },
        // Merged under Autumn's own Stripe Checkout params (it owns customer, mode, line items, success_url).
        checkout_session_params: {
          cancel_url: input.cancelUrl,
          client_reference_id: input.orderId,
          // Cards only: Autumn grants on checkout.session.completed without checking payment_status.
          payment_method_types: ["card"],
          allow_promotion_codes: false,
          saved_payment_method_options: { payment_method_save: "disabled" },
          ...(description ? { custom_text: { submit: { message: description } } } : {}),
        },
        // Never `enable_plan_immediately`: it grants the credit before the buyer pays.
      };

      const attached = yield* autumn.post("billing.attach", attachBody).pipe(
        Effect.map(Option.some),
        Effect.catchTag("AutumnError", (error) => {
          // 409 duplicate_subscription_id: this order's plan was already purchased.
          if (error.status === 409) {
            return Effect.logInfo("Autumn attach: order already purchased", { code: error.code }).pipe(
              Effect.as(Option.none()),
            );
          }
          // Still locked after retries because the order's session was just paid and is materializing.
          if (error.status === 423 && /just completed/i.test(error.message)) {
            return Effect.logInfo("Autumn attach: checkout just completed", { code: error.code }).pipe(
              Effect.as(Option.none()),
            );
          }
          return Effect.fail(error);
        }),
      );
      if (Option.isNone(attached)) return { _tag: "AlreadyPaid" } satisfies CheckoutResult;

      const result = yield* decodeReply(AttachBody, "billing.attach")(attached.value);
      if (result.payment_url && isHttpUrl(result.payment_url)) {
        return { _tag: "Redirect", url: result.payment_url } satisfies CheckoutResult;
      }
      const invoice = Schema.decodeUnknownOption(InvoiceStatus)(result.invoice);
      if (Option.exists(invoice, (value) => value.status === "paid")) {
        return { _tag: "AlreadyPaid" } satisfies CheckoutResult;
      }
      const action = Schema.decodeUnknownOption(RequiredActionCode)(result.required_action);
      return yield* new AutumnError({
        endpoint: "billing.attach",
        status: attached.value.status,
        ...(Option.isSome(action) ? { code: action.value.code } : {}),
        message: "Autumn returned no checkout URL",
      });
    },
    (effect) => effect.pipe(Effect.catchTag("AutumnError", toPaymentError("checkout"))),
  );

  const confirm = Effect.fn("AutumnPayments.confirm")(
    function* (input: { readonly orderId: string; readonly customerId: string }) {
      const customerId = yield* customerIdFor(input.orderId);
      yield* Effect.annotateCurrentSpan({ "order.id": input.orderId, "autumn.customer": customerId });

      const reply = yield* autumn.post("customers.get", { customer_id: customerId }).pipe(
        Effect.map(Option.some),
        Effect.catchTag("AutumnError", (error) =>
          // Checkout never got as far as creating the customer: nothing was paid.
          error.status === 404 && error.code === "customer_not_found" ? Effect.succeedNone : Effect.fail(error),
        ),
      );
      if (Option.isNone(reply)) return "unpaid" as const;

      // Only a real 200 is proof. A 202 or other 2xx could be a degraded answer.
      if (reply.value.status !== 200) {
        return yield* new AutumnError({
          endpoint: "customers.get",
          status: reply.value.status,
          message: "Expected HTTP 200 from customers.get",
        });
      }
      const customer = yield* decodeReply(CustomerBody, "customers.get")(reply.value);
      if (customer.id && customer.id !== customerId) {
        return yield* new AutumnError({
          endpoint: "customers.get",
          status: 200,
          message: "Autumn returned a different customer than requested",
        });
      }
      if (!(yield* isPaid(customer, "customers.get"))) return "unpaid" as const;

      // Consume the order's single credit. The Idempotency-Key makes repeats
      // (webhook + sweeper + page load) land once; a repeat answers 409.
      yield* autumn
        .post(
          "balances.track",
          {
            customer_id: customerId,
            feature_id: options.featureId,
            value: 1,
            properties: { order_id: input.orderId },
          },
          { idempotencyKey: `consume:${input.orderId}` },
        )
        .pipe(
          Effect.catchTag("AutumnError", (error) =>
            error.status === 409 ? Effect.logDebug("Autumn track: already consumed", { code: error.code }) : Effect.fail(error),
          ),
        );
      return "paid" as const;
    },
    (effect) => effect.pipe(Effect.catchTag("AutumnError", toPaymentError("confirm"))),
  );

  return Payments.of({ kind: "autumn", createCheckout, confirm });
});

/** Autumn payments over a caller-supplied `HttpClient` (tests pass a fake one). */
export const layerWith = (options: AutumnPaymentsOptions): Layer.Layer<Payments, never, HttpClient.HttpClient> =>
  Layer.effect(Payments, makeAutumnPayments(options));

/** Autumn payments configured from `AppConfig.autumn`, HTTP client not yet provided. */
export const layerNoDeps: Layer.Layer<Payments, never, AppConfig | HttpClient.HttpClient> = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    if (Option.isNone(config.autumn)) {
      return yield* Effect.die(new Error("Autumn payments need AUTUMN_SECRET_KEY (see docs/payments.md)."));
    }
    return yield* makeAutumnPayments(config.autumn.value);
  }),
);

/** Production layer: Autumn over the platform `fetch`. */
export const AutumnPaymentsLive: Layer.Layer<Payments, never, AppConfig> = layerNoDeps.pipe(
  Layer.provide(FetchHttpClient.layer),
);
