import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";

/** GET /healthz — liveness + a cheap D1 query. */
export const loader = effectLoader("healthz", () =>
  Effect.gen(function* () {
    const stats = yield* (yield* Board).stats;
    return Response.json(
      { ok: true, entries: stats.entries, judgingNow: stats.judgingNow },
      { headers: { "Cache-Control": "no-store" } },
    );
  }),
);
