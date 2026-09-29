import { Context, type Effect } from "effect";
import type { PaymentError } from "../domain/errors";

export interface CheckoutInput {
  readonly orderId: string;
  readonly customerId: string;
  /** Absolute URL the buyer returns to after paying. */
  readonly successUrl: string;
  /** Absolute URL for "back" / cancelled checkouts. */
  readonly cancelUrl: string;
  /** Shown on the checkout page where supported, e.g. "Jev judgment: acme.com". */
  readonly description: string;
}

export type CheckoutResult =
  /** Send the buyer to the hosted checkout page. */
  | { readonly _tag: "Redirect"; readonly url: string }
  /** The customer already holds an unused judgment credit: no checkout needed. */
  | { readonly _tag: "AlreadyPaid" };

/**
 * $5-per-judgment payments. Implemented with Autumn (one-off product that
 * grants one "judgment" credit) or a local simulator for development.
 *
 * `confirm` must be idempotent per order: calling it twice for the same order
 * consumes at most one credit.
 */
export class Payments extends Context.Service<
  Payments,
  {
    readonly kind: "autumn" | "fake";
    readonly createCheckout: (input: CheckoutInput) => Effect.Effect<CheckoutResult, PaymentError>;
    /**
     * Verifies that the customer paid for this order and consumes exactly one
     * judgment credit for it. Returns "unpaid" when no credit is available yet.
     */
    readonly confirm: (input: {
      readonly orderId: string;
      readonly customerId: string;
    }) => Effect.Effect<"paid" | "unpaid", PaymentError>;
    /** Development simulator only: marks an order as paid. */
    readonly simulatePayment?: (orderId: string) => Effect.Effect<void>;
  }
>()("jevboard/Payments") {}
