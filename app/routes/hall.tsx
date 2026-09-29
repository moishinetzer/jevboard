import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import type { Route } from "./+types/hall";

export const loader = effectLoader("hall", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    const hall = yield* board.hall;
    const top = yield* board.top(10);
    const stats = yield* board.stats;
    return { hall, top, king: stats.king, now: Date.now() };
  }),
);

export default function Hall({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-5xl uppercase">Hall of Fame &amp; Shame</h1>
      <p>{loaderData.top.length} entries</p>
    </main>
  );
}
