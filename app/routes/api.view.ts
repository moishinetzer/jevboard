import { Effect, Option } from "effect";
import { recordRowView } from "~/.server/flows/board";
import { effectAction } from "~/.server/http";
import type { Route } from "./+types/api.view";

/** POST /api/view (`site=<siteKey>`, sent as a beacon): a board row was opened in the browser. */
export const action = effectAction("view", ({ request }: Route.ActionArgs) =>
  Effect.gen(function* () {
    const form = yield* Effect.tryPromise(() => request.formData()).pipe(Effect.option);
    const site = Option.isSome(form) ? form.value.get("site") : null;
    if (typeof site === "string" && site !== "") yield* recordRowView(site);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }),
);

export const loader = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
