import { Link } from "react-router";
import { Delta, Favicon, Score, TierBadge, VerdictLabel } from "~/components/ui";
import type { BoardSort } from "~/.server/services/Board";
import { formatCount, timeAgo } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { type BoardRowEntry, FOUNDING_LIMIT, focusRing, serial } from "./shared";

const DAY_MS = 24 * 3600 * 1000;

/**
 * One defendant on the board. The whole row links to the verdict page
 * (a stretched link); "Visit" is a separate link through /go/ so Jev can
 * count the visitors it sends.
 *
 * Phone: rank · name · score on top, TL;DR and chips underneath.
 * Desktop: rank | name + TL;DR + chips | receipts | score.
 */
export function BoardRow({
  entry,
  sort,
  now,
  tied = false,
}: {
  entry: BoardRowEntry;
  sort: BoardSort;
  now: number;
  /** Shares its exact score with a neighbour, so its place was settled in the Duel Pit. */
  tied?: boolean;
}) {
  const king = entry.rank === 1;
  const isNew = entry.rolls === 1 && now - entry.firstJudgedAt < DAY_MS;
  const rolls = entry.rolls > 1 ? `🎲 ×${entry.rolls}` : null;
  const judgedAgo = timeAgo(entry.lastJudgedAt, now);

  return (
    <li
      className={`relative grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b-2 border-line px-3 py-3 transition-colors sm:py-4 [grid-template-areas:'rank_head_score'_'body_body_body'] last:border-b-0 hover:bg-jev/15 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4 sm:[grid-template-areas:'rank_head_score'_'rank_body_score'] lg:grid-cols-[4.5rem_minmax(0,1fr)_12rem_10.5rem] lg:[grid-template-areas:'rank_head_stats_score'_'rank_body_stats_score'] ${
        king ? "bg-jev/15 shadow-[inset_6px_0_0_var(--jev)]" : ""
      }`}
    >
      {/* Rank + movement */}
      <div className="flex flex-col items-center [grid-area:rank]">
        {king ? (
          <span className="-mb-1 text-xl sm:text-2xl" aria-hidden>
            👑
          </span>
        ) : null}
        <span className="font-display text-3xl leading-none tabular-nums sm:text-4xl">
          <span className="text-lg text-ink-soft sm:text-xl">#</span>
          {entry.rank}
        </span>
        {entry.rolls > 1 && entry.lastDelta !== 0 ? (
          <Delta delta={entry.lastDelta} className="mt-1" />
        ) : isNew ? (
          <span className="mt-1 bg-hot px-1 font-mono text-[10px] font-bold text-white uppercase">New</span>
        ) : null}
      </div>

      {/* Name: the stretched link */}
      <div className="flex min-w-0 items-center gap-3 self-center [grid-area:head]">
        <Favicon host={entry.host} size={36} />
        <div className="min-w-0">
          <Link
            to={entryPath(entry.siteKey)}
            className={`block truncate text-base leading-tight font-bold after:absolute after:inset-0 after:content-[''] hover:underline sm:text-lg ${focusRing} focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:-outline-offset-4 focus-visible:after:outline-hot`}
          >
            {entry.name}
          </Link>
          <p className="truncate font-mono text-xs text-ink-soft">
            {entry.siteKey}
            {sort === "newest" ? <span> · judged {judgedAgo}</span> : null}
          </p>
        </div>
      </div>

      {/* TL;DR + stickers */}
      <div className="min-w-0 [grid-area:body]">
        <p className="line-clamp-2 text-sm lg:line-clamp-1" title={entry.tldr}>
          {entry.tldr}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <VerdictLabel label={entry.label} className="max-w-full break-words" />
          <TierBadge score={entry.score} className="sm:hidden" />
          <span className="border border-line px-1.5 py-px text-[10px] font-bold text-ink-soft uppercase">{entry.category}</span>
          {tied ? (
            <span className="border border-line px-1.5 py-px text-[10px] font-bold uppercase" title="Exact-score tie, ordered by Jev's head-to-head duels">
              ⚔️ Duel Pit tie
            </span>
          ) : null}
          {entry.manipulationAttempt ? (
            <span
              className="rotate-[-3deg] border-[3px] border-double border-hot bg-hot/10 px-1.5 py-px font-display text-xs tracking-wider text-hot uppercase"
              title="Jev caught this site trying to instruct or bribe an AI judge"
            >
              🚨 Caught bribing Jev
            </span>
          ) : null}
          {entry.entryNumber <= FOUNDING_LIMIT ? (
            <span
              className="border border-dashed border-line px-1.5 py-px font-mono text-[10px] font-bold text-ink-soft uppercase"
              title={`One of the first ${FOUNDING_LIMIT} businesses Jev ever judged`}
            >
              ★ Founding defendant {serial(entry.entryNumber)}
            </span>
          ) : null}
          {/* Receipts, inline on small screens */}
          <span className="tabular text-[11px] font-bold text-ink-soft lg:hidden">
            {rolls ? <>{rolls} · </> : null}
            {formatCount(entry.clicks)} sent
          </span>
          <VisitLink siteKey={entry.siteKey} className="lg:hidden" />
        </div>
      </div>

      {/* Receipts column (desktop) */}
      <div className="hidden flex-col justify-center gap-1 font-mono text-xs [grid-area:stats] lg:flex">
        {rolls ? (
          <span className="font-bold" title={`Best ${entry.bestScore} · worst ${entry.worstScore}`}>
            {rolls} <span className="font-normal text-ink-soft">retrials · best {entry.bestScore}</span>
          </span>
        ) : (
          <span className="text-ink-soft">Judged {judgedAgo}</span>
        )}
        <span>
          Jev sent <strong>{formatCount(entry.clicks)}</strong> visitor{entry.clicks === 1 ? "" : "s"}
        </span>
        <VisitLink siteKey={entry.siteKey} className="self-start" />
      </div>

      {/* Score */}
      <div className="flex flex-col items-end justify-center gap-1.5 [grid-area:score]">
        <Score score={entry.score} size="text-4xl sm:text-5xl" suffix={false} />
        <span className="hidden sm:block">
          <TierBadge score={entry.score} className="text-[10px]!" />
        </span>
      </div>
    </li>
  );
}

function VisitLink({ siteKey, className }: { siteKey: string; className?: string }) {
  return (
    <a
      href={entryPath(siteKey).replace(/^\/s\//, "/go/")}
      target="_blank"
      rel="sponsored noopener"
      className={`relative z-10 inline-flex items-center gap-1 border-2 border-line bg-card px-1.5 py-px font-mono text-[10px] font-bold uppercase hover:bg-jev hover:text-[#111110] ${focusRing} ${className ?? ""}`}
    >
      Visit <span aria-hidden>↗</span>
      <span className="sr-only"> {siteKey} (opens in a new tab)</span>
    </a>
  );
}
