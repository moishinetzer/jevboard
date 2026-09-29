import { Effect } from "effect";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { defaultCardPng, pngResponse } from "~/.server/og/render";
import { Board } from "~/.server/services/Board";

/** GET /og.png — the site-wide share card with live-ish board stats. */
export const loader = effectLoader("og.default", () =>
  Effect.gen(function* () {
    const stats = yield* (yield* Board).stats;
    const { origin } = yield* CurrentRequest;
    const png = yield* Effect.promise(() =>
      defaultCardPng(
        {
          entries: stats.entries,
          judgments: stats.judgments,
          revenueCents: stats.revenueCents,
          king: stats.king ? { siteKey: stats.king.siteKey, score: stats.king.score } : null,
          host: new URL(origin).host,
        },
        origin,
      ),
    );
    return pngResponse(png);
  }),
);
