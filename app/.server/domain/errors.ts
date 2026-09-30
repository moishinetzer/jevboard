import { Schema } from "effect";

/**
 * Typed failures. Each carries a user-facing `message`; the route helpers map
 * the tags below to HTTP statuses (see `app/.server/http.ts`).
 */

/** 400 — the submitted URL can't be judged (bad syntax, private host, ...). */
export class InvalidSite extends Schema.TaggedError<InvalidSite>()("InvalidSite", {
  input: Schema.String,
  message: Schema.String,
}) {}

/** 404 — no such entry / order. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  what: Schema.String,
  message: Schema.String,
}) {}

export const CrawlFailureReason = Schema.Literals([
  "blocked", // SSRF guard: private IP, bad port, disallowed redirect
  "dns", // host does not resolve
  "unreachable", // connection refused / reset / TLS failure
  "timeout",
  "http", // non-2xx after redirects
  "too-large",
  "not-html",
  "offsite", // the homepage redirects to a different site
]);
export type CrawlFailureReason = typeof CrawlFailureReason.Type;

/** The crawler could not fetch the site. */
export class CrawlError extends Schema.TaggedError<CrawlError>()("CrawlError", {
  url: Schema.String,
  reason: CrawlFailureReason,
  message: Schema.String,
  /** The HTTP status, for `reason: "http"`. */
  status: Schema.optional(Schema.Number),
}) {}

/** HTTP statuses that usually mean "try again later" rather than "no". */
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 529, 530]);

/**
 * Worth another try later: timeouts, dropped connections, DNS hiccups (the
 * site resolved at submit time) and "busy" statuses. A 403, a 404, a non-HTML
 * page or a redirect off-site won't change by waiting.
 */
export const isTransientCrawlError = (error: CrawlError): boolean =>
  error.reason === "timeout" ||
  error.reason === "unreachable" ||
  error.reason === "dns" ||
  (error.reason === "http" && error.status !== undefined && TRANSIENT_HTTP.has(error.status));

export const JudgeFailureReason = Schema.Literals([
  "refused", // model declined (stop_reason refusal)
  "invalid-output", // structured output missing / failed validation
  "api", // transport / 5xx / rate limit after retries
  "config", // missing API key etc.
]);
export type JudgeFailureReason = typeof JudgeFailureReason.Type;

/** Jev (the LLM) could not produce a usable verdict. */
export class JudgeError extends Schema.TaggedError<JudgeError>()("JudgeError", {
  reason: JudgeFailureReason,
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

/** 502 — the payment provider failed or rejected the request. */
export class PaymentError extends Schema.TaggedError<PaymentError>()("PaymentError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}
