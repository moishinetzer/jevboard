import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { JudgeForm } from "~/components/judge-form";
import { JevFace, MEDAL_TINT, medalFor, RankBadge } from "~/components/logo";
import { Meter, SiteAvatar, ViewsSpark } from "~/components/ui";
import { goPath } from "~/components/verdict/links";
import { formatCount } from "~/lib/format";
import { entryPath } from "~/lib/site-key";

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

const views = (count: number): string => `${formatCount(count)} ${count === 1 ? "view" : "views"}`;

/**
 * One business on the board. The row is a link: to /s/<site> when closed
 * (which opens it in place and counts a view), back to the board when open.
 * The top three get a crown and a gold, silver or bronze tint.
 */
export function BoardRow({
  entry,
  viewCount,
  details,
  closeHref,
  first,
}: {
  entry: BoardEntry;
  /** Views over the last 30 days. */
  viewCount: number;
  /** Present when this row is the open one. */
  details: Details | null;
  closeHref: string;
  /** The first row on the page (no divider above it). */
  first: boolean;
}) {
  const open = details !== null;
  const medal = medalFor(entry.rank);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const frame = medal
    ? `rounded-2xl border-[1.5px] sm:rounded-[18px] ${MEDAL_TINT[medal]}`
    : open
      ? "rounded-2xl border border-line bg-paper sm:rounded-[18px]"
      : first
        ? ""
        : "border-t border-line";

  return (
    <li ref={ref} className={`scroll-mt-6 ${frame}`}>
      <Link
        to={open ? closeHref : entryPath(entry.siteKey)}
        preventScrollReset
        aria-expanded={open}
        className="grid grid-cols-[50px_36px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[inherit] py-3 pr-3 pl-2 text-ink sm:grid-cols-[64px_44px_minmax(0,1fr)_auto] sm:gap-x-3.5 sm:py-3.5 sm:pr-[18px] sm:pl-3"
      >
        <span className="justify-self-center">
          <RankBadge rank={entry.rank} />
        </span>
        <SiteAvatar host={entry.host} className="size-9 sm:size-11" />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold sm:text-base">
            {entry.name}
            <span className="ml-1.5 hidden text-[13px] font-medium text-soft sm:inline">{entry.siteKey}</span>
          </span>
          <span className="block truncate text-xs text-soft sm:hidden">{entry.siteKey}</span>
          {open ? null : (
            <span className="mt-[3px] hidden text-sm leading-[1.45] text-soft sm:line-clamp-2">{entry.tldr}</span>
          )}
        </span>
        <span className="text-right">
          <span className={`block font-display text-xl font-bold tabular-nums sm:text-[22px] ${medal ? "text-accent" : ""}`}>
            {entry.score}
          </span>
          {viewCount > 0 ? <span className="hidden text-xs text-soft sm:block">{views(viewCount)}</span> : null}
        </span>
      </Link>
      {details ? <EntryDetails entry={entry} details={details} /> : null}
    </li>
  );
}

function EntryDetails({ entry, details }: { entry: BoardEntry; details: Details }) {
  const { judgment } = details;
  const total = details.views.reduce((sum, day) => sum + day.views, 0);

  return (
    <div className="px-3.5 pb-4 sm:pr-[22px] sm:pb-[22px] sm:pl-[90px]">
      <p className="text-[15px] leading-[1.55] sm:text-[17px]">{entry.tldr}</p>

      {judgment ? (
        <>
          <h3 className="mt-3.5 text-xs font-bold sm:mt-[18px] sm:text-[13px]">Why Jev put it at #{entry.rank}</h3>
          <p className="mt-1 text-sm leading-relaxed text-soft sm:text-[15px]">{judgment.reasoning}</p>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-x-7 sm:gap-y-2.5">
            {BREAKDOWN.map(([key, label]) => (
              <Meter key={key} label={label} value={judgment.subscores[key]} />
            ))}
          </div>
        </>
      ) : null}

      <figure className="mt-3.5 flex items-start gap-2 rounded-xl border border-line bg-card px-3 py-2.5 sm:mt-[18px] sm:gap-2.5 sm:rounded-[14px] sm:px-3.5 sm:py-3">
        <JevFace size={28} label="Jev says" className="size-6 shrink-0 sm:size-7" />
        <blockquote className="text-sm leading-normal italic sm:text-[15px]">“{entry.verdict}”</blockquote>
      </figure>

      {entry.manipulationAttempt ? (
        <p className="mt-3 rounded-xl border border-bad/40 px-3 py-2 text-sm font-semibold text-bad">
          This site tried to give Jev instructions. Jev noticed and marked it down.
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-col gap-3 sm:mt-[18px] sm:flex-row sm:items-center sm:gap-2.5">
        <p className="flex items-center gap-2 text-xs text-soft sm:gap-2.5 sm:text-[13px]">
          <ViewsSpark days={details.views} />
          {views(total)} in the last 30 days
        </p>
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-start">
          <a href={goPath(entry.siteKey)} target="_blank" rel="sponsored noopener" className="btn btn-ghost h-11 px-4 text-sm sm:h-10">
            Visit <span aria-hidden>↗</span>
          </a>
          {details.canRejudge ? (
            <JudgeForm siteUrl={entry.url} buttonClassName="btn h-12 w-full px-4 text-[15px] sm:h-10 sm:w-auto sm:text-sm" />
          ) : null}
        </div>
      </div>
      {details.canRejudge ? (
        <p className="mt-1.5 text-center text-[11px] text-soft sm:mt-2 sm:text-right sm:text-xs">
          Only you see Rejudge. You submitted this one.
        </p>
      ) : null}
    </div>
  );
}
