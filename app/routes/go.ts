import { Effect, Option } from "effect";
import { data, redirect } from "react-router";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/go";

/** Adds `utm_source=rankedbyjev` unless the URL already names a source. */
const withSource = (url: string): string => {
  try {
    const target = new URL(url);
    if (!target.searchParams.has("utm_source")) target.searchParams.set("utm_source", "rankedbyjev");
    return target.toString();
  } catch {
    return url;
  }
};

/**
 * GET /go/<siteKey>: counts the visit ("Jev sent N visitors") and redirects to
 * the site, tagged `utm_source=rankedbyjev` so its analytics show where the visit came from.
 */
export const loader = effectLoader("go", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const siteKey = (params["*"] ?? "").toLowerCase();
    const url = yield* (yield* Board).recordClick(siteKey);
    if (Option.isNone(url)) return yield* Effect.die(data({ error: "NotFound", message: "Unknown site." }, { status: 404 }));
    return redirect(withSource(url.value), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "origin" } });
  }),
);
