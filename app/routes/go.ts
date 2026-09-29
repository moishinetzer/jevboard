import { Effect, Option } from "effect";
import { data, redirect } from "react-router";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/go";

/** GET /go/<siteKey> — counts the visit ("Jev sent N visitors") and redirects to the site. */
export const loader = effectLoader("go", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const siteKey = (params["*"] ?? "").toLowerCase();
    const url = yield* (yield* Board).recordClick(siteKey);
    if (Option.isNone(url)) return yield* Effect.die(data({ error: "NotFound", message: "Unknown site." }, { status: 404 }));
    return redirect(url.value, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "origin" } });
  }),
);
