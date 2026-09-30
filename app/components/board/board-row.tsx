import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { JudgeForm } from "~/components/judge-form";
import { Favicon, Meter, Score, TierBadge } from "~/components/ui";
import { CopyButton } from "~/components/verdict/copy-button";
import { entryPath } from "~/lib/site-key";
import { focusRing } from "./shared";
import { ViewsTile } from "./views-tile";

interface Details {
  readonly judgment: Judgment | null;
  readonly views: ReadonlyArray<{ readonly day: string; readonly views: number }>;
  readonly canRejudge: boolean;
}

const BREAKDOWN = [
  ["clarity", "Clarity"],
  ["demand", "Real demand"],
  ["originality", "Originality"],
  ["trust", "Trust"],
  ["wouldJevPay", "Would Jev pay"],
] as const;

/**
 * One business on the leaderboard. The header row is a link: to /s/<site>
 * when closed (which opens it in place and counts a view), back to the board
 * when open.
 */
export function BoardRow({
  entry,
  details,
  closeHref,
  origin,
}: {
  entry: BoardEntry;
  /** Present when this row is the open one. */
  details: Details | null;
  closeHref: string;
  origin: string;
}) {
  const open = details !== null;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <li ref={ref} className={`scroll-mt-24 border-b-2 border-line last:border-b-0 ${open ? "bg-jev/10" : ""}`}>
      <Link
        to={open ? closeHref : entryPath(entry.siteKey)}
        preventScrollReset
        aria-expanded={open}
        className={`grid grid-cols-[2.5rem_2rem_minmax(0,1fr)_auto_1rem] items-center gap-x-3 px-3 py-3 hover:bg-jev/15 sm:grid-cols-[3rem_2.25rem_minmax(0,1fr)_auto_1rem] sm:px-4 ${focusRing}`}
      >
        <span className="text-center font-display text-2xl leading-none tabular-nums sm:text-3xl">{entry.rank}</span>
        <Favicon host={entry.host} size={32} />
        <span className="min-w-0">
          <span className="block truncate font-bold sm:text-lg">
            {entry.name}
            <span className="ml-2 font-mono text-xs font-normal text-ink-soft">{entry.siteKey}</span>
          </span>
          {open ? null : <span className="block truncate text-sm text-ink-soft">{entry.tldr}</span>}
        </span>
        <Score score={entry.score} size="text-3xl sm:text-4xl" suffix={false} />
        <span aria-hidden className="text-ink-soft">
          {open ? "▾" : "▸"}
        </span>
      </Link>
      {details ? <EntryDetails entry={entry} details={details} origin={origin} /> : null}
    </li>
  );
}

function EntryDetails({ entry, details, origin }: { entry: BoardEntry; details: Details; origin: string }) {
  const { judgment } = details;
  const url = `${origin}${entryPath(entry.siteKey)}`;

  return (
    <div className="grid gap-8 px-4 pt-2 pb-8 sm:pl-[6.75rem] lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <p className="text-lg leading-relaxed sm:text-xl">{entry.tldr}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Score score={entry.score} size="text-5xl" />
          <TierBadge score={entry.score} />
          <span className="text-sm text-ink-soft">
            #{entry.rank} on the board · {entry.category}
          </span>
        </div>

        {judgment ? (
          <>
            <h3 className="mt-6 text-sm font-bold uppercase tracking-wide">Why this score</h3>
            <p className="mt-1.5 max-w-prose leading-relaxed">{judgment.reasoning}</p>

            <h3 className="mt-6 text-sm font-bold uppercase tracking-wide">Breakdown</h3>
            <div className="mt-2 grid max-w-xl gap-x-6 gap-y-3 sm:grid-cols-2">
              {BREAKDOWN.map(([key, label]) => (
                <Meter key={key} label={label} value={judgment.subscores[key]} />
              ))}
            </div>

            {judgment.strengths.length > 0 || judgment.weaknesses.length > 0 ? (
              <div className="mt-6 grid max-w-xl gap-4 text-sm sm:grid-cols-2">
                <ul className="flex flex-col gap-1">
                  {judgment.strengths.map((item) => (
                    <li key={item}>
                      <span aria-hidden className="font-bold text-up">✓ </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <ul className="flex flex-col gap-1">
                  {judgment.weaknesses.map((item) => (
                    <li key={item}>
                      <span aria-hidden className="font-bold text-down">✗ </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        <h3 className="mt-6 text-sm font-bold uppercase tracking-wide">Jev's take</h3>
        <blockquote className="mt-1.5 max-w-prose border-l-4 border-jev pl-3 text-ink-soft italic">“{entry.verdict}”</blockquote>

        {entry.manipulationAttempt ? (
          <p className="mt-4 inline-block border-2 border-hot px-2 py-1 text-sm font-bold text-hot">
            🚨 This site tried to instruct the AI judge. Jev noticed and marked it down.
          </p>
        ) : null}
      </div>

      <aside className="flex w-full max-w-sm min-w-0 flex-col gap-5 lg:max-w-none">
        <ViewsTile label="Views, last 30 days" days={details.views} />
        <div className="flex flex-col gap-2">
          <a
            href={entryPath(entry.siteKey).replace(/^\/s\//, "/go/")}
            target="_blank"
            rel="sponsored noopener"
            className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}
          >
            Visit {entry.siteKey} <span aria-hidden>↗</span>
          </a>
          <CopyButton text={url} label="Copy link" copiedLabel="Link copied" className="btn btn-ghost px-4 py-2 text-sm" />
          {details.canRejudge ? (
            <div className="mt-2 border-t-2 border-dashed border-line pt-4">
              <p className="mb-2 text-sm text-ink-soft">You submitted this business. Changed your site? Ask Jev again.</p>
              <JudgeForm siteUrl={entry.url} size="md" />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
