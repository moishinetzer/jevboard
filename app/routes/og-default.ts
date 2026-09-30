import { Effect } from "effect";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { defaultCardPng, pngResponse } from "~/.server/og/render";
import { Board } from "~/.server/services/Board";

/** GET /og.png — the site-wide share card, naming the current #1. */
export const loader = effectLoader("og.default", () =>
  Effect.gen(function* () {
    const stats = yield* (yield* Board).stats;
    const { origin } = yield* CurrentRequest;
    const png = yield* Effect.promise(() =>
      defaultCardPng({ king: stats.king ? { siteKey: stats.king.siteKey } : null }, origin),
    );
    return pngResponse(png);
  }),
);
