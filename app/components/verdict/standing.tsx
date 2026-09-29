import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { BoardEntry } from "~/.server/domain/models";
import { Favicon, Histogram } from "~/components/ui";
import { entryPath } from "~/lib/site-key";
import { bucketFor } from "./links";

/** The sites directly above and below on the board (rank ±2). */
export function Neighbours({ entry, neighbours }: { entry: BoardEntry; neighbours: ReadonlyArray<BoardEntry> }) {
  return (
    <ol className="slab divide-y-2 divide-line/25">
      {neighbours.map((neighbour) => {
        const self = neighbour.id === entry.id;
        const gap = neighbour.score - entry.score;
        const note = self ? (
          "This defendant"
        ) : gap === 0 ? (
          <>
            Tied<span className="hidden sm:inline"> · settled by duel</span>
          </>
        ) : gap > 0 ? (
          `${gap} pts above`
        ) : (
          `${-gap} pts below`
        );
        return (
          <li
            key={neighbour.id}
            aria-current={self ? "true" : undefined}
            className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${self ? "bg-jev text-[#111110]" : ""}`}
          >
            <span className="w-12 shrink-0 font-display text-2xl tabular-nums">#{neighbour.rank}</span>
            <Favicon host={neighbour.host} size={28} />
            <div className="min-w-0 flex-1">
              {self ? (
                <span className="block truncate font-bold">{neighbour.siteKey}</span>
              ) : (
                <Link to={entryPath(neighbour.siteKey)} className="block truncate font-bold hover:underline">
                  {neighbour.siteKey}
                </Link>
              )}
              <span className={`block truncate font-mono text-[11px] ${self ? "" : "text-ink-soft"}`}>
                {neighbour.label}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <span className="score-num text-3xl">{neighbour.score}</span>
              <span className={`block text-[10px] font-bold tracking-wide uppercase ${self ? "" : "text-ink-soft"}`}>
                {note}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Score distribution with a "you are here" pointer under the entry's bucket. */
export function WhereItStands({
  score,
  histogram,
  caption,
}: {
  score: number;
  histogram: ReadonlyArray<number>;
  caption: string;
}) {
  const bucket = bucketFor(score);
  // Keep the pointer label inside the box at both ends of the scale.
  const pointer: CSSProperties =
    bucket <= 1
      ? { left: `${bucket * 10 + 1}%` }
      : bucket >= 8
        ? { right: `${(9 - bucket) * 10 + 1}%` }
        : { left: `${(bucket + 0.5) * 10}%`, transform: "translateX(-50%)" };
  return (
    <figure className="slab p-5 sm:p-6">
      <Histogram buckets={histogram} highlight={score} />
      <div className="relative mt-2 h-6">
        <span className="absolute top-0 font-mono text-[11px] font-bold whitespace-nowrap uppercase" style={pointer}>
          <span className="text-hot">▲</span> You are here · {score}
        </span>
      </div>
      <figcaption className="mt-3 border-t-2 border-line pt-3 text-base font-bold">{caption}</figcaption>
    </figure>
  );
}
