import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/entry";

export const loader = effectLoader("entry", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const board = yield* Board;
    const siteKey = decodeURIComponent(params["*"] ?? "").toLowerCase().replace(/\/+$/, "");
    const entry = yield* board.getBySiteKey(siteKey);
    const judgments = yield* board.judgments(entry.id);
    const duels = yield* board.duelsForEntry(entry.id, 30);
    const neighbours = yield* board.neighbours(entry.id, 2);
    const stats = yield* board.stats;
    const percentile = stats.entries > 1 ? Math.round(((stats.entries - entry.rank) / (stats.entries - 1)) * 100) : 100;
    return { entry, judgments, duels, neighbours, histogram: stats.histogram, totalEntries: stats.entries, percentile };
  }),
);

export default function Entry({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-5xl">{loaderData.entry.siteKey}</h1>
      <p>{loaderData.entry.score}/1000 · #{loaderData.entry.rank}</p>
    </main>
  );
}
