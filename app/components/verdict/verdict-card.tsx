import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { JevFace } from "~/components/logo";
import { Delta, Favicon, TierBadge, VerdictLabel } from "~/components/ui";
import { formatCount, SCORE_TIERS, timeAgo } from "~/lib/format";
import { goPath, serialLabel } from "./links";

/** "Better than 83% of defendants", with the edge cases handled. */
export const percentileLine = (rank: number, total: number, percentile: number): string => {
  if (total <= 1) return "The only defendant so far. Technically #1.";
  if (rank === 1) return "Better than every other defendant.";
  if (rank === total) return "Dead last. Someone has to be.";
  return `Better than ${percentile}% of defendants.`;
};

/** Jev, speaking: the roast as a speech bubble. */
export function RoastBubble({ verdict, className }: { verdict: string; className?: string }) {
  return (
    <figure className={`flex items-start gap-3 sm:gap-5 ${className ?? ""}`}>
      <JevFace size={64} className="mt-1 size-12 shrink-0 sm:size-18" />
      <div className="relative min-w-0 flex-1 border-[3px] border-line bg-card px-4 py-4 shadow-[5px_5px_0_var(--shadow)] sm:px-6 sm:py-5">
        <span
          aria-hidden
          className="absolute top-5 -left-[11px] size-[18px] rotate-45 border-b-[3px] border-l-[3px] border-line bg-card"
        />
        <blockquote className="text-xl leading-snug font-bold text-pretty sm:text-[1.7rem]">“{verdict}”</blockquote>
        <figcaption className="mt-3 font-mono text-[11px] font-bold tracking-widest text-ink-soft uppercase">
          — Jev, presiding
        </figcaption>
      </div>
    </figure>
  );
}

/** A 1–1000 ruler coloured by tier, with the score marked. */
export function ScoreRuler({ score }: { score: number }) {
  const stops = [...SCORE_TIERS].reverse();
  const gradient = stops
    .map((tier, index) => {
      const from = ((tier.min - 1) / 1000) * 100;
      const to = index + 1 < stops.length ? ((stops[index + 1]!.min - 1) / 1000) * 100 : 100;
      return `${tier.color} ${from}% ${to}%`;
    })
    .join(", ");
  const position = Math.max(0, Math.min(100, (score / 1000) * 100));
  return (
    <div aria-hidden>
      <div className="relative h-4 border-2 border-[#111110]" style={{ background: `linear-gradient(90deg, ${gradient})` }}>
        <span className="absolute -top-2.5 bottom-[-10px] w-[4px] -translate-x-1/2 bg-[#111110]" style={{ left: `${position}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] font-bold">
        <span>1 · useless</span>
        <span>1000 · essential</span>
      </div>
    </div>
  );
}

/** The top of the verdict page: identity, score, rank, the roast and what to do next. */
export function VerdictHero({
  entry,
  judgment,
  totalEntries,
  percentile,
  now,
}: {
  entry: BoardEntry;
  judgment: Judgment | undefined;
  totalEntries: number;
  percentile: number;
  now: number;
}) {
  const reigning = entry.rank === 1;
  const founding = entry.entryNumber <= 100;
  const retrials = entry.rolls - 1;

  return (
    <article aria-labelledby="verdict-name" className="slab relative">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-[3px] border-line bg-ink px-4 py-2 font-mono text-[11px] font-bold tracking-widest text-paper uppercase sm:px-6">
        <span>⚖️ The verdict{judgment ? ` · Judgment ${serialLabel(judgment.serial)}` : ""}</span>
        <span>
          {entry.rolls > 1 ? `Roll ${entry.rolls} · ` : ""}Judged{" "}
          <time dateTime={new Date(entry.lastJudgedAt).toISOString()}>{timeAgo(entry.lastJudgedAt, now)}</time>
        </span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] lg:grid-rows-[auto_1fr]">
        {/* Identity */}
        <div className="min-w-0 px-5 pt-6 pb-2 sm:px-8 sm:pt-8 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Favicon host={entry.host} size={44} />
            <span className="font-mono text-sm font-bold [overflow-wrap:anywhere]">{entry.siteKey}</span>
            <span className="border-2 border-line px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide uppercase">
              {entry.category}
            </span>
          </div>
          <h1
            id="verdict-name"
            className="mt-4 font-display text-6xl leading-[0.88] uppercase [overflow-wrap:anywhere] sm:text-7xl lg:text-8xl"
          >
            {entry.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {reigning ? <span className="sticker text-sm">👑 Reigning #1</span> : null}
            {founding ? (
              <span className="sticker bg-ink! text-paper!" title="One of the first 100 sites Jev ever judged">
                ★ Founding defendant #{String(entry.entryNumber).padStart(3, "0")}
              </span>
            ) : null}
            {entry.clicks > 0 ? (
              <span className="sticker bg-card! text-ink!">
                Jev sent {formatCount(entry.clicks)} visitor{entry.clicks === 1 ? "" : "s"}
              </span>
            ) : null}
            {retrials > 0 ? (
              <span className="sticker bg-card! text-ink!">
                🎲 {retrials} retrial{retrials === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {entry.manipulationAttempt ? (
            <div className="mt-5 inline-block -rotate-2 border-[3px] border-[#111110] bg-hot px-3 py-2 text-[#111110] shadow-[4px_4px_0_var(--shadow)]">
              <p className="font-display text-2xl leading-none uppercase sm:text-3xl">🚨 Caught trying to bribe Jev</p>
              <p className="mt-1 font-mono text-[11px] font-bold tracking-wider uppercase">
                Hidden instructions found on the site. Jev noticed. Jev remembers.
              </p>
            </div>
          ) : null}
        </div>

        {/* Score */}
        <aside
          aria-label="Score and rank"
          className="mt-4 flex flex-col gap-5 border-y-[3px] border-line bg-jev p-5 text-[#111110] sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:border-y-0 lg:border-l-[3px]"
        >
          <div>
            <p className="font-mono text-[11px] font-bold tracking-widest uppercase">Usefulness, according to Jev</p>
            <p className="mt-2 flex items-end gap-2">
              <span className="score-num text-[8.5rem] sm:text-[10rem]">{entry.score}</span>
              <span className="pb-2 font-mono text-lg font-bold">/1000</span>
            </p>
            {entry.rolls > 1 ? (
              <p className="mt-2 flex items-center gap-2 text-sm font-bold">
                Last retrial <Delta delta={entry.lastDelta} className="bg-[#fffdf6] px-1 py-0.5 text-sm" />
              </p>
            ) : null}
          </div>
          <ScoreRuler score={entry.score} />
          <dl className="grid grid-cols-2 border-[3px] border-[#111110] bg-[#fffdf6]">
            <div className="border-r-[3px] border-[#111110] p-3">
              <dt className="font-mono text-[10px] font-bold tracking-widest uppercase">Rank</dt>
              <dd className="font-display text-5xl leading-none">#{entry.rank}</dd>
              <dd className="mt-1 text-xs font-bold">of {formatCount(totalEntries)} on the board</dd>
            </div>
            <div className="p-3">
              <dt className="font-mono text-[10px] font-bold tracking-widest uppercase">Percentile</dt>
              <dd className="font-display text-5xl leading-none">{percentile}%</dd>
              <dd className="mt-1 text-xs font-bold">of the docket beaten</dd>
            </div>
          </dl>
          <p className="text-lg leading-tight font-bold">{percentileLine(entry.rank, totalEntries, percentile)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge score={entry.score} className="bg-[#fffdf6]!" />
          </div>
        </aside>

        {/* The ruling */}
        <div className="min-w-0 px-5 pt-6 pb-7 sm:px-8 sm:pb-9 lg:col-start-1 lg:row-start-2">
          <p className="font-mono text-[11px] font-bold tracking-widest text-ink-soft uppercase">Jev's label</p>
          <VerdictLabel label={entry.label} className="mt-1.5 px-3! py-1! text-base! sm:text-lg!" />
          <RoastBubble verdict={entry.verdict} className="mt-7" />
          <div className="mt-7 border-l-[6px] border-jev pl-4">
            <p className="font-mono text-[11px] font-bold tracking-widest uppercase">TL;DR</p>
            <p className="mt-1 text-lg leading-snug text-pretty">{entry.tldr}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={goPath(entry.siteKey)} target="_blank" rel="noopener nofollow ugc" className="btn px-5 py-3">
              Visit site ↗<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href="#share" className="btn btn-ghost px-5 py-3">
              Share the verdict
            </a>
            <a href="#retrial" className="btn btn-ghost px-5 py-3">
              Demand a retrial
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
