import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { JudgmentQueue } from "~/.server/services/JudgmentQueue";

/** GET /healthz — liveness + a cheap DB query. */
export const loader = effectLoader("healthz", () =>
  Effect.gen(function* () {
    const stats = yield* (yield* Board).stats;
    const pending = yield* (yield* JudgmentQueue).pending;
    return Response.json({ ok: true, entries: stats.entries, pending }, { headers: { "Cache-Control": "no-store" } });
  }),
);
