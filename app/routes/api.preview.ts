import { Effect } from "effect";
import { previewSite } from "~/.server/flows/preview";
import { effectAction } from "~/.server/http";
import type { Route } from "./+types/api.preview";

/** POST /api/preview (`url=<site>`): the guided onboarding's read of a site, before anyone pays. */
export const action = effectAction("preview", ({ request }: Route.ActionArgs) =>
  Effect.gen(function* () {
    const form = yield* Effect.promise(() => request.formData());
    return yield* previewSite(String(form.get("url") ?? "").slice(0, 500));
  }),
);

export const loader = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
