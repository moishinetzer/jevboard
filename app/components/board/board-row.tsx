import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { RowDetails } from "~/.server/flows/board";
import type { BoardEntry } from "~/.server/domain/models";
import { JudgeForm } from "~/components/judge-form";
import { JevFace, MEDAL_TINT, medalFor } from "~/components/logo";
import { Meter, SiteIcon, ViewsSpark } from "~/components/ui";
import { goPath } from "~/components/verdict/links";
import { formatCount, timeAgo } from "~/lib/format";
import { entryPath } from "~/lib/site-key";

const BREAKDOWN = [
  ["clarity", "Clarity"],
  ["demand", "Real demand"],
  ["originality", "Originality"],
  ["trust", "Trust"],
  ["wouldJevPay", "Would Jev pay"],
] as const;

/** How long a row takes to open or close (matches `.expander` in app.css). */
const EXPAND_MS = 320;

const views = (count: number): string => `${formatCount(count)} ${count === 1 ? "view" : "views"}`;
const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const clicks = (count: number): string => `${formatCount(count)} ${count === 1 ? "click" : "clicks"}`;

/** Icons scale with rank like outbid's: #1 biggest, #2 a little smaller, the rest the same. */
const ICON_SIZE = (rank: number): string =>
  rank === 1 ? "size-11 sm:size-16" : rank === 2 ? "size-11 sm:size-[58px]" : "size-11 sm:size-[52px]";

/**
 * True while the row is open and for the length of its closing animation,
 * so the details stay mounted until they have slid shut.
 */
function usePresence(open: boolean): boolean {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    const timer = setTimeout(() => setPresent(false), EXPAND_MS);
    return () => clearTimeout(timer);
  }, [open, present]);
  return open || present;
}

/**
 * One business on the board, the way outbid.lol lays one out: a faded rank,
 * its app icon, and its own title and description from its homepage, then
 * when Jev judged it, its address, how many clicks the board sent it and
 * "see details". Clicking the row opens the site in a new tab; "see details"
 * or the chevron opens Jev's verdict in place (/s/<site>). Everything the
 * open row shows came with the board, so it opens at once and slides open.
 * The top three keep a gold, silver or bronze tint.
 */
export function BoardRow({
  entry,
  details,
  days,
  open,
  closeHref,
  first,
}: {
  entry: BoardEntry;
  /** What the opened row shows (preloaded with the board). */
  details: RowDetails | null;
  /** The days `details.views` counts, oldest first. */
  days: ReadonlyArray<string>;
  open: boolean;
  closeHref: string;
  /** The first row on the page (no divider above it). */
  first: boolean;
}) {
  const medal = medalFor(entry.rank);
  const present = usePresence(open);

  // A row open on arrival (/s/<site>) is scrolled to straight away; one opened
  // by a click is brought into view once it has finished opening, if needed.
  const ref = useRef<HTMLLIElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    const firstRun = !arrived.current;
    arrived.current = true;
    if (!open) return;
    if (firstRun) {
      ref.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    const timer = setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), EXPAND_MS);
    return () => clearTimeout(timer);
  }, [open]);

  const frame = medal
    ? `rounded-2xl border-[1.5px] sm:rounded-[18px] ${MEDAL_TINT[medal]}`
    : open
      ? "rounded-2xl border border-line bg-paper sm:rounded-[18px]"
      : first
        ? ""
        : "border-t border-line";

  return (
    <li ref={ref} className={`scroll-mt-6 transition-colors duration-300 ${frame}`}>
      <div className="relative grid grid-cols-[26px_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[inherit] py-3 pr-3 pl-1 transition-colors hover:bg-ink/[0.03] sm:grid-cols-[44px_auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:py-3.5 sm:pr-3 sm:pl-2">
        <span
          className={`text-center font-display text-[15px] font-bold tabular-nums sm:text-xl ${medal ? "text-accent/60" : "text-soft/45"}`}
        >
          #{entry.rank}
        </span>
        <SiteIcon host={entry.host} iconUrl={entry.iconUrl} className={ICON_SIZE(entry.rank)} />
        <div className="min-w-0">
          {/* The title's link stretches over the whole row: clicking the row visits the site. */}
          <a
            href={goPath(entry.siteKey)}
            target="_blank"
            rel="noopener"
            className="block truncate text-[15px] font-bold text-ink after:absolute after:inset-0 after:rounded-[inherit] sm:text-base"
          >
            {entry.siteTitle ?? entry.name}
          </a>
          <p className={`mt-0.5 text-[13px] leading-snug text-soft sm:text-sm ${open ? "" : "truncate"}`}>
            {entry.siteDescription ?? entry.tldr}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-soft/80">
            {/* Phones skip the age to keep the line short. */}
            <span suppressHydrationWarning className="hidden sm:inline">
              {timeAgo(entry.lastJudgedAt)}
            </span>
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
            <span className="max-w-full truncate">{entry.siteKey}</span>
            {entry.clicks > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span>{clicks(entry.clicks)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <Link
              to={open ? closeHref : entryPath(entry.siteKey)}
              preventScrollReset
              aria-expanded={open}
              className="relative z-10 font-semibold text-soft underline decoration-soft/40 underline-offset-2 hover:text-ink hover:decoration-ink"
            >
              {open ? "hide details" : "see details"}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1.5">
          <span className={`font-display text-xl font-bold tabular-nums sm:text-[22px] ${medal ? "text-accent" : "text-ink"}`}>
            {entry.score}
          </span>
          <Link
            to={open ? closeHref : entryPath(entry.siteKey)}
            preventScrollReset
            tabIndex={-1}
            aria-hidden
            className="relative z-10 hidden size-8 place-items-center rounded-full text-soft transition-colors hover:bg-pill hover:text-ink sm:grid"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Link>
        </div>
      </div>
      {present && details ? (
        <div className="expander" data-open={open} inert={!open}>
          <div className="min-h-0 overflow-hidden">
            <EntryDetails entry={entry} details={details} days={days} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function EntryDetails({ entry, details, days }: { entry: BoardEntry; details: RowDetails; days: ReadonlyArray<string> }) {
  const daily = days.map((day, index) => ({ day, views: details.views[index] ?? 0 }));

  return (
    <div className="px-3.5 pb-4 sm:pr-[22px] sm:pb-[22px] sm:pl-[68px]">
      {/* Jev's own summary, unless the row above already shows the same words. */}
      {sameText(entry.tldr, entry.siteDescription ?? entry.tldr) ? null : (
        <p className="text-[15px] leading-[1.55] sm:text-base">{entry.tldr}</p>
      )}

      {details.reasoning ? (
        <>
          <h3 className="mt-3.5 text-xs font-bold first:mt-1 sm:mt-[18px] sm:first:mt-1 sm:text-[13px]">Why Jev put it at #{entry.rank}</h3>
          <p className="mt-1 text-sm leading-relaxed text-soft sm:text-[15px]">{details.reasoning}</p>
          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-x-7 sm:gap-y-2.5">
            {BREAKDOWN.map(([key, label]) => (
              <Meter key={key} label={label} value={entry.subscores[key]} />
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
          <ViewsSpark days={daily} />
          {views(details.totalViews)} so far
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
