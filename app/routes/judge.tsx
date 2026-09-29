import { Effect } from "effect";
import { data, redirect } from "react-router";
import { CurrentRequest, effectAction } from "~/.server/http";
import { submitSite } from "~/.server/flows/submit";
import type { Route } from "./+types/judge";

/**
 * POST /judge — "Get judged — $5" and "Demand a retrial — $5" both land here.
 * Submit with a fetcher (`<fetcher.Form method="post" action="/judge">`) so
 * validation errors come back as fetcher data while successful submissions
 * redirect to checkout.
 */
export const action = effectAction("judge", ({ request }: Route.ActionArgs) =>
  Effect.gen(function* () {
    // Only our own pages may start a checkout.
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin && origin !== (yield* CurrentRequest).origin) {
      return data({ ok: false, field: "url", message: "Submit from jevboard itself, please.", value: "" }, { status: 403 });
    }
    const form = yield* Effect.promise(() => request.formData());
    const url = String(form.get("url") ?? "");
    const result = yield* submitSite(url);
    if (result instanceof Response) return result;
    return data(result, { status: 400 });
  }),
);

export const loader = () => redirect("/#judge");
