import { effectAction } from "~/.server/http";
import { handleAutumnWebhook } from "~/.server/services/payments/webhook";
import type { Route } from "./+types/api.autumn-webhook";

/**
 * POST /api/autumn/webhook — Autumn's Svix-signed `billing.updated` events.
 * Verifies the signature (AUTUMN_WEBHOOK_SECRET), then re-confirms the order's
 * payment with Autumn and queues the judgment. 404 when no secret is set.
 */
export const action = effectAction("autumn-webhook", ({ request }: Route.ActionArgs) => handleAutumnWebhook(request));

export const loader = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
