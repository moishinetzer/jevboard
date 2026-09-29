import { Fragment } from "react";
import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { JudgeForm } from "~/components/judge-form";
import { Delta } from "~/components/ui";
import { timeAgo } from "~/lib/format";
import { serialLabel } from "./links";

/** "Demand a retrial — $5": the pitch, the button, and the full record of every roll. */
export function RetrialBox({
  entry,
  judgments,
  now,
}: {
  entry: BoardEntry;
  /** Newest first. */
  judgments: ReadonlyArray<Judgment>;
  now: number;
}) {
  const chronological = [...judgments].sort((a, b) => a.roll - b.roll);
  const spread = entry.bestScore - entry.worstScore;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="slab flex flex-col gap-5 bg-[#111110]! p-5 text-[#fbf6e7] sm:p-7">
        <p className="font-display text-3xl leading-[1.05] uppercase sm:text-4xl">Jev re-reads everything from scratch.</p>
        <p className="text-lg leading-snug">
          Your score can go up. It can also go down.{" "}
          <span className="bg-jev px-1 font-bold text-[#111110]">That's the point.</span>
        </p>
        <JudgeForm siteUrl={entry.url} />
        <p className="text-sm text-[#fbf6e7]/75">
          $5 buys one fresh evaluation, not a better number. The newest verdict stands — even when it's worse. Crawl
          failed? The retry is free.
        </p>
      </div>

      <div className="slab min-w-0 p-5 sm:p-6">
        <dl className="grid grid-cols-2 border-2 border-line sm:grid-cols-4">
          <Stat label="Rolls" value={entry.rolls} className="border-r-2 border-b-2 sm:border-b-0" />
          <Stat label="Best" value={entry.bestScore} className="border-b-2 sm:border-r-2 sm:border-b-0" />
          <Stat label="Worst" value={entry.worstScore} className="border-r-2" />
          <Stat label="Spread" value={spread} />
        </dl>

        <div className="mt-6">
          <p className="font-mono text-[11px] font-bold tracking-widest uppercase">Score history</p>
          {chronological.length > 1 ? (
            <HistoryChart judgments={chronological} />
          ) : (
            <p className="mt-2 border-2 border-dashed border-line p-4 text-sm text-ink-soft">
              One verdict so far. The chart gets interesting after the first retrial.
            </p>
          )}
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Every verdict for {entry.siteKey}, newest first</caption>
            <thead>
              <tr className="border-b-[3px] border-line font-mono text-[10px] tracking-widest uppercase">
                <th scope="col" className="py-2 pr-3">Judgment</th>
                <th scope="col" className="py-2 pr-3 text-right">Score</th>
                <th scope="col" className="py-2 pr-3">Δ</th>
                <th scope="col" className="py-2 pr-3 text-right">Placed</th>
                <th scope="col" className="hidden py-2 sm:table-cell">Label</th>
              </tr>
            </thead>
            <tbody>
              {judgments.map((judgment, index) => {
                const current = index === 0;
                const tone = current ? "bg-jev text-[#111110]" : "";
                return (
                  <Fragment key={judgment.id}>
                    <tr className={`align-top ${tone} ${current ? "" : "border-t-2 border-line/20"}`}>
                      <td className="py-2.5 pr-3 pl-1">
                        <span className="tabular font-bold">{serialLabel(judgment.serial)}</span>
                        <span className={`block text-[11px] whitespace-nowrap ${current ? "" : "text-ink-soft"}`}>
                          <time dateTime={new Date(judgment.createdAt).toISOString()}>{timeAgo(judgment.createdAt, now)}</time>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <span className="score-num text-2xl">{judgment.score}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        {judgment.previousScore === null ? (
                          <span className="font-mono text-[11px] font-bold uppercase">debut</span>
                        ) : (
                          <Delta
                            delta={judgment.score - judgment.previousScore}
                            className={current ? "bg-[#fffdf6] px-1" : ""}
                          />
                        )}
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right font-bold">#{judgment.rankAtPlacement}</td>
                      <td className="hidden py-2.5 font-mono text-xs sm:table-cell">
                        {judgment.label}
                        {current ? <span className="ml-2 sticker bg-[#111110]! text-jev!">current</span> : null}
                      </td>
                    </tr>
                    <tr className={`sm:hidden ${tone}`}>
                      <td colSpan={4} className="pb-2.5 pl-1 font-mono text-xs [overflow-wrap:anywhere]">
                        “{judgment.label}”{current ? " · current verdict" : ""}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={`border-line p-3 ${className ?? ""}`}>
      <dt className="font-mono text-[10px] font-bold tracking-widest uppercase">{label}</dt>
      <dd className="score-num mt-1 text-4xl">{value}</dd>
    </div>
  );
}

/**
 * Score across rolls on a y-axis zoomed to the data (a +25 retrial should look
 * like something). Geometry is SVG stretched to the box; markers and labels are
 * HTML so they stay round and legible at any width. The table below is the
 * accessible data view.
 */
function HistoryChart({ judgments }: { judgments: ReadonlyArray<Judgment> }) {
  const scores = judgments.map((judgment) => judgment.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const pad = Math.max(25, Math.round((max - min) * 0.3));
  const lo = Math.max(0, Math.floor((min - pad) / 25) * 25);
  const hi = Math.min(1000, Math.ceil((max + pad) / 25) * 25);
  const last = judgments.length - 1;
  const x = (index: number) => 6 + (index / last) * 88;
  const y = (score: number) => 10 + (1 - (score - lo) / (hi - lo)) * 80;
  const best = scores.indexOf(max);
  const worst = scores.lastIndexOf(min);
  const labelled = new Set([last, best, worst]);
  const ticks = [...new Set([hi, lo + Math.round((hi - lo) / 50) * 25, lo])];

  return (
    <div className="mt-2" role="img" aria-label={`Score history, oldest to newest: ${scores.join(", ")}`}>
    <div className="flex gap-1.5">
      <div className="relative w-8 shrink-0" aria-hidden>
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2 font-mono text-[10px] text-ink-soft"
            style={{ top: `${y(tick)}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
      <div className="relative h-44 min-w-0 flex-1 border-2 border-line bg-paper" aria-hidden>
        {ticks.map((tick) => (
          <span key={tick} className="absolute inset-x-0 border-t border-dashed border-ink/15" style={{ top: `${y(tick)}%` }} />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-ink">
          <polyline
            points={scores.map((score, index) => `${x(index)},${y(score)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {judgments.map((judgment, index) => {
          const isLast = index === last;
          const below = index === worst && index !== best && !isLast;
          return (
            <span key={judgment.id}>
              <span
                title={`Roll ${judgment.roll} · Judgment ${serialLabel(judgment.serial)} · ${judgment.score}/1000`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line before:absolute before:-inset-2 before:content-[''] ${
                  isLast ? "size-3.5 bg-hot" : "size-3 bg-card"
                }`}
                style={{ left: `${x(index)}%`, top: `${y(judgment.score)}%` }}
              />
              {labelled.has(index) ? (
                <span
                  className={`absolute -translate-x-1/2 font-display text-lg leading-none whitespace-nowrap ${
                    below ? "translate-y-2.5" : "-translate-y-[calc(100%+10px)]"
                  }`}
                  style={{ left: `${x(index)}%`, top: `${y(judgment.score)}%` }}
                >
                  {judgment.score}
                  {isLast ? <span className="ml-1 font-mono text-[10px] font-bold text-ink-soft uppercase">now</span> : null}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
    <div className="mt-1 ml-9.5 flex justify-between font-mono text-[10px] font-bold text-ink-soft uppercase" aria-hidden>
      <span>Roll 1</span>
      <span>Roll {judgments.length}</span>
    </div>
    </div>
  );
}
