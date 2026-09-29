import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/stats";

export const loader = effectLoader("stats", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    const stats = yield* board.stats;
    const daily = yield* board.daily(30);
    const categories = yield* board.categories;
    return { stats, daily, categories, now: Date.now() };
  }),
);

export default function Stats({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-5xl uppercase">Receipts</h1>
      <p>{loaderData.stats.judgments} judgments</p>
    </main>
  );
}
