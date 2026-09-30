import { Effect } from "effect";
import { data } from "react-router";
import { previewSite } from "~/.server/flows/preview";
import { CurrentRequest, effectAction } from "~/.server/http";
import type { Route } from "./+types/api.preview";

/** POST /api/preview (`url=<site>`): the guided onboarding's read of a site, before anyone pays. */
export const action = effectAction("preview", ({ request }: Route.ActionArgs) =>
  Effect.gen(function* () {
    // Only our own pages may ask (each uncached read costs a crawl and a model call).
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin && origin !== (yield* CurrentRequest).origin) {
      return data({ ok: false, field: "rate", message: "Ask from rankedbyjev.com itself, please." }, { status: 403 });
    }
    const form = yield* Effect.promise(() => request.formData());
    return yield* previewSite(String(form.get("url") ?? "").slice(0, 500));
  }),
);

export const loader = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
