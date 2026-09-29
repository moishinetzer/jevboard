import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { loadFeed } from "~/.server/flows/shell";
import type { Route } from "./+types/api.feed";

/** GET /api/feed?after=<eventId> — The Tape + live counters, polled every few seconds. */
export const loader = effectLoader("api.feed", ({ request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const after = Number(new URL(request.url).searchParams.get("after"));
    const feed = yield* loadFeed(Number.isFinite(after) && after > 0 ? after : undefined);
    return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
  }),
);
