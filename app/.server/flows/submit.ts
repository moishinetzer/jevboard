import { Effect, Option, Result } from "effect";
import { redirect } from "react-router";
import { normalizeErrorMessage, normalizeSite } from "~/lib/site-key";
import type { CrawlError } from "../domain/errors";
import { parseIntake } from "../domain/intake";
import { CustomerId } from "../domain/ids";
import { CurrentRequest } from "../request";
import { Board } from "../services/Board";
import { Crawler } from "../services/Crawler";
import { JudgmentQueue } from "../services/JudgmentQueue";
import { Orders } from "../services/Orders";
import { Payments } from "../services/Payments";
import { RateLimiter } from "../services/RateLimiter";
import { track } from "../services/Analytics";

/** What the submit form renders when a submission can't proceed. */
export interface SubmitFailure {
  readonly ok: false;
  readonly field: "url" | "payment" | "rate";
  readonly message: string;
  readonly value: string;
}

export const preflightMessage = (error: CrawlError): string => {
  switch (error.reason) {
    case "dns":
      return "Jev looked everywhere and that domain doesn't seem to exist.";
    case "blocked":
      return "Jev isn't allowed to visit that address.";
    case "timeout":
      return "That site took too long to answer. Jev won't charge you to judge a ghost. Try again later.";
    case "http":
      return `That site answered with an error (${error.message}). Fix it before Jev sees it.`;
    case "not-html":
      return "That URL isn't a web page. Jev judges websites, not files.";
    case "offsite":
      return `That address ${error.message}. Submit the site it lands on instead.`;
    default:
      return "Jev couldn't reach that site. Double-check the URL.";
  }
};

/**
 * "Get judged — $5". Validates the URL, makes sure the site is reachable
 * *before* taking money, creates a pending order and sends the buyer to
 * checkout. Submitting a site that's already on the board is a reroll.
 */
export const submitSite = Effect.fn("submitSite")(function* (rawUrl: string, rawIntake?: unknown) {
  const request = yield* CurrentRequest;
  const limiter = yield* RateLimiter;
  // Cookie-less requests get no visitor bucket of their own (a fresh id each
  // time would never hit a limit): they only count against their IP.
  const allowed =
    (request.visitorIsNew || (yield* limiter.allow("visitor", request.visitorId))) &&
    (yield* limiter.allow("ip", request.clientIp));
  if (!allowed) {
    return {
      ok: false,
      field: "rate",
      message: "Easy there. Jev needs a minute before checking more sites for you.",
      value: rawUrl,
    } satisfies SubmitFailure;
  }
  const normalized = normalizeSite(rawUrl);
  if (!normalized.ok) {
    yield* track("judgment_rejected", { reason: normalized.error });
    return { ok: false, field: "url", message: normalizeErrorMessage[normalized.error], value: rawUrl } satisfies SubmitFailure;
  }
  const site = normalized.site;

  const preflight = yield* Effect.result((yield* Crawler).preflight(site.url));
  if (Result.isFailure(preflight)) {
    yield* track("judgment_rejected", { reason: `unreachable:${preflight.failure.reason}`, site: site.siteKey });
    return { ok: false, field: "url", message: preflightMessage(preflight.failure), value: rawUrl } satisfies SubmitFailure;
  }

  const existing = yield* (yield* Board).findBySiteKey(site.siteKey);
  const orders = yield* Orders;
  // The guided onboarding's answers (claims for Jev, the board's link) only count on a
  // first judgment, or a rejudge by someone who paid for this site before: a stranger's
  // rejudge can't put words in the owner's mouth or repoint their row.
  const intake = parseIntake(rawIntake, site.url);
  const trusted =
    intake !== null && (Option.isNone(existing) || (yield* orders.paidSites(request.visitorId)).includes(site.siteKey));
  const order = yield* orders.create({
    customerId: CustomerId.make(request.visitorId),
    siteKey: site.siteKey,
    url: site.url,
    kind: Option.isSome(existing) ? "reroll" : "new",
    entryId: Option.isSome(existing) ? existing.value.id : null,
    intake: trusted ? intake : null,
  });

  const payments = yield* Payments;
  const checkout = yield* Effect.result(
    payments.createCheckout({
      orderId: order.id,
      customerId: request.visitorId,
      successUrl: `${request.origin}/judging/${order.id}`,
      cancelUrl: `${request.origin}/?cancelled=${order.id}`,
      description: `${Option.isSome(existing) ? "Jev retrial" : "Jev judgment"}: ${site.siteKey}`,
    }),
  );
  if (Result.isFailure(checkout)) {
    yield* Effect.logError("Checkout failed", checkout.failure);
    return {
      ok: false,
      field: "payment",
      message: "The payment desk is jammed. No money moved. Try again in a minute.",
      value: rawUrl,
    } satisfies SubmitFailure;
  }

  yield* track("checkout_started", { order_id: order.id, site: site.siteKey, kind: order.kind });

  if (checkout.success._tag === "AlreadyPaid") {
    // An unused credit from an earlier purchase covers this judgment.
    const paid = yield* payments.confirm({ orderId: order.id, customerId: request.visitorId }).pipe(
      Effect.catchTag("PaymentError", () => Effect.succeed("unpaid" as const)),
    );
    if (paid === "paid" && (yield* orders.markPaid(order.id))) {
      yield* track("payment_confirmed", { order_id: order.id, site: site.siteKey, kind: order.kind, via: "credit" });
      yield* (yield* JudgmentQueue).enqueue(order.id);
    }
    return redirect(`/judging/${order.id}`);
  }
  return redirect(checkout.success.url);
});
