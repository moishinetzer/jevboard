import { Link } from "react-router";
import { JevFace } from "~/components/logo";
import { formatCount } from "~/lib/format";
import { BoardControls } from "./board-controls";
import { BoardRow } from "./board-row";
import { Pagination } from "./pagination";
import { type BoardFilters, type BoardRowEntry, focusJudgeInput, focusRing, homeHref, MARKER, SORT_TABS } from "./shared";

interface Listing {
  readonly entries: ReadonlyArray<BoardRowEntry>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** "The Board": every defendant, sortable, searchable, filterable, paginated. */
export function Board({
  listing,
  filters,
  categories,
  now,
}: {
  listing: Listing;
  filters: BoardFilters;
  categories: ReadonlyArray<{ category: string; count: number }>;
  now: number;
}) {
  const tab = SORT_TABS.find((item) => item.sort === filters.sort) ?? SORT_TABS[0];
  const first = (listing.page - 1) * listing.pageSize + 1;
  // On rank-ordered tabs, neighbours with the exact same score were separated by duels.
  const rankOrdered = filters.sort === "rank" || filters.sort === "today" || filters.sort === "week";
  const tied = (index: number) => {
    const score = listing.entries[index]!.score;
    return rankOrdered && (listing.entries[index - 1]?.score === score || listing.entries[index + 1]?.score === score);
  };
  const last = first + listing.entries.length - 1;

  return (
    <section id="board" aria-labelledby="board-title" className="mx-auto max-w-7xl scroll-mt-32 px-4 pt-14 sm:pt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="board-title" className="font-display text-6xl uppercase sm:text-8xl">
            The Board
          </h2>
          <p className="mt-1 max-w-xl text-ink-soft">{tab.blurb}</p>
        </div>
        <p className="font-mono text-sm font-bold" aria-live="polite">
          {listing.total > 0 ? (
            <>
              {listing.total > listing.entries.length ? `${formatCount(first)}–${formatCount(last)} of ` : ""}
              <span className={MARKER}>
                {formatCount(listing.total)} defendant{listing.total === 1 ? "" : "s"}
              </span>
              {filters.query ? ` matching “${filters.query}”` : ""}
              {filters.category ? ` in ${filters.category}` : ""}
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-6">
        <BoardControls filters={filters} categories={categories} />
      </div>

      <div className="slab mt-6 overflow-hidden">
        <div
          className="hidden border-b-[3px] border-line bg-ink px-4 py-2 font-mono text-[11px] font-bold tracking-widest text-paper uppercase lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)_12rem_10.5rem] lg:gap-x-4"
          aria-hidden
        >
          <span className="text-center">Rank</span>
          <span>Defendant · TL;DR · Jev's verdict</span>
          <span>Receipts</span>
          <span className="text-right">Score /1000</span>
        </div>
        {listing.entries.length > 0 ? (
          <ol aria-label={`${tab.label} board`}>
            {listing.entries.map((entry, index) => (
              <BoardRow key={entry.siteKey} entry={entry} sort={filters.sort} now={now} tied={tied(index)} />
            ))}
          </ol>
        ) : (
          <EmptyDocket filters={filters} total={listing.total} />
        )}
      </div>

      <Pagination filters={filters} total={listing.total} pageSize={listing.pageSize} />
    </section>
  );
}

function EmptyDocket({ filters, total }: { filters: BoardFilters; total: number }) {
  const filtered = filters.query !== "" || filters.category !== "";
  const pastTheEnd = total > 0;
  const quiet = filters.sort === "today" || filters.sort === "week";

  let title = "The docket is empty.";
  let body = "Be the first defendant. The throne is warm and completely unoccupied.";
  let action: { to: string; label: string } | null = null;

  if (pastTheEnd) {
    title = "You've scrolled past the last defendant.";
    body = "There's nobody down here. Not even the sites Jev hated.";
    action = { to: homeHref(filters, { page: 1 }), label: "Back to page 1" };
  } else if (filtered) {
    title = filters.query ? `No defendants match “${filters.query}”.` : `Nobody in ${filters.category} yet.`;
    body = "Jev looked. Twice. Maybe they haven't paid for Jev's attention yet.";
    action = { to: homeHref(filters, { query: "", category: "" }), label: "Clear the filters" };
  } else if (quiet) {
    title = filters.sort === "today" ? "Nobody faced Jev today." : "A quiet week in court.";
    body = "The bench is bored. Give Jev something to judge.";
    action = { to: homeHref(filters, { sort: "rank" }), label: "See the all-time board" };
  }

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center" role="status">
      <JevFace size={84} className="animate-wiggle" />
      <p className="font-display text-3xl uppercase sm:text-5xl">{title}</p>
      <p className="max-w-md text-ink-soft">{body}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {action ? (
          <Link to={action.to} preventScrollReset className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}>
            {action.label}
          </Link>
        ) : null}
        <a href="#judge" onClick={focusJudgeInput} className={`btn px-4 py-2 text-sm ${focusRing}`}>
          {pastTheEnd || filtered ? "Get judged — $5" : "Be the first defendant — $5"}
        </a>
      </div>
    </div>
  );
}
