import { Clock, Effect, Option, Redacted, Result, Schema } from "effect";
import { AppConfig } from "../../config";
import { JudgmentQueue } from "../JudgmentQueue";
import { Orders } from "../Orders";
import { orderIdFromAutumnCustomer } from "./AutumnPayments";

/**
 * Autumn → Jevboard webhooks (POST /api/autumn/webhook), delivered by Svix.
 *
 * The webhook only speeds things up for buyers who paid and closed the tab:
 * it never marks anything paid by itself. A `billing.updated` for customer
 * `jev_<orderId>` just triggers `JudgmentQueue.settle`, which re-verifies the
 * payment with Autumn (`Payments.confirm`) before queueing the judgment. The
 * one-minute payment sweeper is the backstop when a delivery is missed.
 */

// ---------------------------------------------------------------------------
// Svix signature verification (https://docs.svix.com/receiving/verifying-payloads/how-manual)
// ---------------------------------------------------------------------------

/** Svix rejects deliveries whose timestamp is more than 5 minutes off. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

/** Reads `svix-*` headers (or the unbranded Standard Webhooks `webhook-*` ones). */
export const svixHeaders = (headers: Headers): SvixHeaders => ({
  id: headers.get("svix-id") ?? headers.get("webhook-id"),
  timestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
  signature: headers.get("svix-signature") ?? headers.get("webhook-signature"),
});

export type SvixVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 400 | 401; readonly reason: string };

// Web Crypto + atob/btoa only (no node:crypto / Buffer): this runs on
// Cloudflare Workers as well as Node.

const encoder = new TextEncoder();

/** Standard base64 → bytes; None when the input isn't base64. */
const fromBase64 = (value: string): Option.Option<Uint8Array<ArrayBuffer>> => {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return Option.some(bytes);
  } catch {
    return Option.none();
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Compares every byte regardless of where the first difference is. */
const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
};

/** `whsec_<base64>` → HMAC key bytes (a bare base64 secret is accepted too). */
const secretKey = (secret: string): Option.Option<Uint8Array<ArrayBuffer>> =>
  fromBase64(secret.trim().replace(/^whsec_/, "")).pipe(Option.filter((key) => key.length > 0));

const hmacSha256 = (key: Uint8Array<ArrayBuffer>, content: string): Effect.Effect<Uint8Array, unknown> =>
  Effect.tryPromise(() => crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])).pipe(
    Effect.flatMap((cryptoKey) => Effect.tryPromise(() => crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(content)))),
    Effect.map((signature) => new Uint8Array(signature)),
  );

/** `v1,<base64 HMAC-SHA256 of "{id}.{timestamp}.{body}">` — the entry Svix sends. Exported for tests/tools. */
export const signSvix = (
  secret: string,
  id: string,
  timestamp: string | number,
  body: string,
): Effect.Effect<string, unknown> =>
  Option.match(secretKey(secret), {
    onNone: () => Effect.fail(new Error("Webhook secret is empty or not base64")),
    onSome: (key) => Effect.map(hmacSha256(key, `${id}.${timestamp}.${body}`), (mac) => `v1,${toBase64(mac)}`),
  });

/**
 * Verifies a Svix delivery against the endpoint's signing secret. `body` must
 * be the raw request body, exactly as received. The signature header may hold
 * several space-separated `v1,<sig>` entries (secret rotation); any match wins.
 * Never fails: problems are reported as `{ ok: false }`.
 */
export const verifySvixSignature = (input: {
  readonly secret: string;
  readonly headers: SvixHeaders;
  readonly body: string;
  readonly nowSeconds: number;
  readonly toleranceSeconds?: number;
}): Effect.Effect<SvixVerification> =>
  Effect.gen(function* () {
    const { id, timestamp, signature } = input.headers;
    if (!id || !timestamp || !signature) {
      return { ok: false, status: 400, reason: "missing Svix signature headers" } as const;
    }
    if (!/^\d{1,15}$/.test(timestamp)) return { ok: false, status: 400, reason: "malformed svix-timestamp" } as const;

    const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
    if (Math.abs(input.nowSeconds - Number(timestamp)) > tolerance) {
      return { ok: false, status: 401, reason: "timestamp outside the 5 minute tolerance" } as const;
    }

    const key = secretKey(input.secret);
    if (Option.isNone(key)) return { ok: false, status: 401, reason: "webhook secret is empty or not base64" } as const;
    const expected = yield* Effect.option(hmacSha256(key.value, `${id}.${timestamp}.${input.body}`));
    if (Option.isNone(expected)) return { ok: false, status: 401, reason: "could not compute signature" } as const;

    for (const entry of signature.split(" ")) {
      const comma = entry.indexOf(",");
      if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
      const provided = fromBase64(entry.slice(comma + 1));
      if (Option.isSome(provided) && constantTimeEqual(provided.value, expected.value)) return { ok: true } as const;
    }
    return { ok: false, status: 401, reason: "no matching signature" } as const;
  });

// ---------------------------------------------------------------------------
// Event routing
// ---------------------------------------------------------------------------

/** Envelope: `{ type, data, id?, occurred_at? }`. Only what we route on is decoded. */
const Envelope = Schema.Struct({ type: Schema.String, data: Schema.optional(Schema.Unknown) });
/** `billing.updated` data (2.4) carries `customer_id`; legacy `customer.products.updated` has `customer.id`. */
const BillingData = Schema.Struct({ customer_id: Schema.String });
const LegacyData = Schema.Struct({ customer: Schema.Struct({ id: Schema.String }) });
const PlanChanges = Schema.Struct({ plan_changes: Schema.Array(Schema.Unknown) });
const PlanChangeAction = Schema.Struct({ action: Schema.String });

const PAYMENT_EVENTS: ReadonlySet<string> = new Set(["billing.updated", "customer.products.updated"]);

export type WebhookDecision =
  | { readonly _tag: "Settle"; readonly orderId: string }
  | { readonly _tag: "Ignore"; readonly reason: string };

/** Which order (if any) a verified webhook payload is about. Pure. */
export const decideWebhook = (payload: unknown): WebhookDecision => {
  const envelope = Schema.decodeUnknownOption(Envelope)(payload);
  if (Option.isNone(envelope)) return { _tag: "Ignore", reason: "not an Autumn event" };
  const { type, data } = envelope.value;
  if (!PAYMENT_EVENTS.has(type)) return { _tag: "Ignore", reason: `event type ${type}` };

  const customerId = Schema.decodeUnknownOption(BillingData)(data).pipe(
    Option.map((value) => value.customer_id),
    Option.orElse(() => Option.map(Schema.decodeUnknownOption(LegacyData)(data), (value) => value.customer.id)),
  );
  if (Option.isNone(customerId)) return { _tag: "Ignore", reason: "no customer id" };
  const orderId = orderIdFromAutumnCustomer(customerId.value);
  if (Option.isNone(orderId)) return { _tag: "Ignore", reason: "not a Jevboard order customer" };

  // A billing.updated that only schedules/updates/expires plans can't be a new payment.
  // (Unrecognised shapes still settle: the payment is re-verified with Autumn anyway.)
  const changes = Schema.decodeUnknownOption(PlanChanges)(data);
  if (type === "billing.updated" && Option.isSome(changes) && changes.value.plan_changes.length > 0) {
    const activated = changes.value.plan_changes.some((change) =>
      Option.exists(Schema.decodeUnknownOption(PlanChangeAction)(change), (value) => value.action === "activated"),
    );
    if (!activated) return { _tag: "Ignore", reason: "no activated plan" };
  }
  return { _tag: "Settle", orderId: orderId.value };
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Svix payloads are small; anything bigger is not from Autumn. */
const MAX_BODY_BYTES = 256 * 1024;

const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Handles one webhook delivery and always answers with a Response:
 * 404 when no AUTUMN_WEBHOOK_SECRET is configured, 400/401 for bad or missing
 * signatures, 2xx for every well-signed event (including ignored ones), and
 * 503 when settling hit a payment-provider error so Svix redelivers later.
 */
export const handleAutumnWebhook = Effect.fn("handleAutumnWebhook")(function* (request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const config = yield* AppConfig;
  const secret = Option.flatMap(config.autumn, (autumn) => autumn.webhookSecret);
  if (Option.isNone(secret)) return new Response("Not Found", { status: 404 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ ok: false, error: "payload too large" }, 413);
  }
  const body = yield* Effect.tryPromise(() => request.text()).pipe(Effect.option);
  if (Option.isNone(body)) return json({ ok: false, error: "unreadable body" }, 400);
  if (body.value.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload too large" }, 413);

  const headers = svixHeaders(request.headers);
  const now = yield* Clock.currentTimeMillis;
  // AUTUMN_WEBHOOK_SECRET may hold several secrets (space or comma separated),
  // e.g. the sandbox and production endpoints while switching over. Any match wins.
  const secrets = Redacted.value(secret.value).split(/[\s,]+/).filter((value) => value !== "");
  let verification: SvixVerification = { ok: false, status: 401, reason: "no webhook secret configured" };
  for (const candidate of secrets) {
    verification = yield* verifySvixSignature({
      secret: candidate,
      headers,
      body: body.value,
      nowSeconds: Math.floor(now / 1000),
    });
    if (verification.ok || verification.status === 400) break;
  }
  if (!verification.ok) {
    yield* Effect.logWarning("Rejected Autumn webhook", { reason: verification.reason, svixId: headers.id });
    return json({ ok: false, error: "invalid signature" }, verification.status);
  }

  const payload = parseJson(body.value);
  if (Option.isNone(payload)) return json({ ok: false, error: "body is not JSON" }, 400);

  return yield* Effect.gen(function* () {
    const decision = decideWebhook(payload.value);
    if (decision._tag === "Ignore") {
      yield* Effect.logDebug("Ignoring Autumn webhook", { reason: decision.reason });
      return json({ ok: true, ignored: decision.reason });
    }

    const orders = yield* Orders;
    const order = yield* orders.find(decision.orderId);
    if (Option.isNone(order)) {
      // Another deployment sharing the Autumn environment, or a deleted order.
      yield* Effect.logInfo("Autumn webhook for an unknown order", { orderId: decision.orderId });
      return json({ ok: true, ignored: "unknown order" });
    }
    if (order.value.status !== "pending_payment") {
      return json({ ok: true, orderId: order.value.id, status: order.value.status });
    }

    const settled = yield* Effect.result((yield* JudgmentQueue).settle(order.value.id, order.value.customerId));
    if (Result.isFailure(settled)) {
      yield* Effect.logWarning("Autumn webhook: could not confirm payment yet", settled.failure);
      return json({ ok: false, error: "payment provider unavailable, retry later" }, 503);
    }
    const after = yield* orders.find(order.value.id);
    const status = Option.match(after, { onNone: () => order.value.status, onSome: (value) => value.status });
    yield* Effect.logInfo("Autumn webhook processed", { orderId: order.value.id, status });
    return json({ ok: true, orderId: order.value.id, status });
  }).pipe(Effect.annotateLogs({ svixId: headers.id ?? "" }));
});
