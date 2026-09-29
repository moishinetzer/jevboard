import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";

export const loader = effectLoader("tv", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    return { top: yield* board.top(10), stats: yield* board.stats, now: Date.now() };
  }),
);

export default function Tv() {
  return <main className="p-10 font-display text-6xl uppercase">TV mode</main>;
}
