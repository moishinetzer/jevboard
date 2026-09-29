import { Effect } from "effect";
import { useRef } from "react";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { pageMeta } from "~/components/pages/meta";
import { ON_INK } from "~/components/pages/shared";
import {
  FullscreenButton,
  KingPanel,
  toTvEntry,
  TvBoard,
  TvCallToAction,
  TvClock,
  TvCounters,
  TvFeed,
  TvMarquee,
  UpdatedAgo,
  useAutoRevalidate,
} from "~/components/pages/tv/tv";
import type { Route } from "./+types/tv";

/** How often TV mode re-runs its loader (the tape and counters also poll on their own). */
const REFRESH_MS = 15_000;

export const loader = effectLoader("tv", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    const top = yield* board.top(10);
    const { origin } = yield* CurrentRequest;
    return { top: top.map(toTvEntry), origin, host: new URL(origin).host, now: Date.now() };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) => [
  ...pageMeta({
    title: "TV mode",
    description: "Jevboard, live and full screen: the top 10, the reign of #1 and The Tape. For streams, office screens and the morbidly curious.",
    path: "/tv",
    origin: loaderData?.origin,
  }),
  { name: "robots", content: "noindex" },
];

export default function Tv({ loaderData }: Route.ComponentProps) {
  const screen = useRef<HTMLElement>(null);
  const lastUpdated = useAutoRevalidate(REFRESH_MS);

  return (
    <>
      <main ref={screen} style={ON_INK} className="flex min-h-[calc(100dvh-7rem)] flex-col overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6 lg:px-10 lg:py-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-3 font-display text-[clamp(2rem,min(4vw,6vh),4.5rem)] uppercase leading-none">
              <span className="flex items-center gap-2 bg-hot px-2.5 py-1 text-[0.45em] text-white">
                <span className="size-2.5 animate-blink rounded-full bg-white" aria-hidden />
                Live
              </span>
              Jev<span className="-ml-3 text-hot">board</span> TV
            </h1>
            <div className="flex flex-wrap items-center gap-4">
              <TvCallToAction host={loaderData.host} />
              <UpdatedAgo at={lastUpdated} />
              <TvClock serverNow={loaderData.now} />
              <FullscreenButton target={screen} />
            </div>
          </header>

          <div className="grid flex-1 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(22rem,1fr)]">
            <section aria-labelledby="tv-board-title" className="min-w-0">
              <h2 id="tv-board-title" className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-ink-soft">
                The board · top 10 · all-time
              </h2>
              <TvBoard entries={loaderData.top} />
            </section>
            <div className="flex min-w-0 flex-col gap-4 xl:pt-7">
              <KingPanel serverNow={loaderData.now} />
              <TvCounters />
              <TvFeed serverNow={loaderData.now} />
            </div>
          </div>
        </div>
        <TvMarquee />
      </main>
    </>
  );
}
