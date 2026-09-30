import { Effect, Option } from "effect";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { siteKeyFromAssetPath } from "~/.server/og/path";
import { entryCardPng, pngResponse } from "~/.server/og/render";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/og";

const notFound = () =>
  new Response("Not on the docket. Jev hasn't judged this site (yet).", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });

/** GET /og/<siteKey>.png — the 1200×630 verdict share card. */
export const loader = effectLoader("og", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const siteKey = siteKeyFromAssetPath(params["*"], "png");
    const board = yield* Board;
    const found = yield* board.findBySiteKey(siteKey);
    if (Option.isNone(found)) return notFound();
    const entry = found.value;

    const [latest] = yield* board.judgments(entry.id);
    const { total } = yield* board.page({ page: 1, pageSize: 1 });
    const { origin } = yield* CurrentRequest;

    const png = yield* Effect.promise(() =>
      entryCardPng(
        latest?.id ?? `${entry.id}:${entry.rolls}`,
        {
          siteKey: entry.siteKey,
          score: entry.score,
          rank: entry.rank,
          total,
          tldr: entry.tldr,
          serial: latest?.serial ?? entry.entryNumber,
          roll: entry.rolls,
          host: new URL(origin).host,
        },
        origin,
      ),
    );
    return pngResponse(png);
  }),
);
