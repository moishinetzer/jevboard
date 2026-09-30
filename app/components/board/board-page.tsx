import { Link } from "react-router";
import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { JudgeForm } from "~/components/judge-form";
import { formatCount } from "~/lib/format";
import { BoardRow } from "./board-row";
import { boardHref, focusJudgeInput, focusRing } from "./shared";
import { ViewsTile } from "./views-tile";

type ViewDays = ReadonlyArray<{ readonly day: string; readonly views: number }>;

/** What the one-page board needs (the loader data of `/` and `/s/<site>`). */
export interface BoardPageData {
  readonly listing: {
    readonly entries: ReadonlyArray<BoardEntry>;
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
  };
  readonly boardViews: ViewDays;
  readonly open: {
    readonly entry: BoardEntry;
    readonly judgment: Judgment | null;
    readonly views: ViewDays;
    readonly canRejudge: boolean;
  } | null;
  readonly judging: ReadonlyArray<{ readonly id: string; readonly siteKey: string }>;
  readonly checkoutCancelled: boolean;
  readonly cancelledSite: string | null;
  readonly origin: string;
}

/**
 * The whole site on one page: what Jev does and the $5 form first, then the
 * leaderboard. Opening a business expands it in place.
 */
export function BoardPage({ data }: { data: BoardPageData }) {
  const { listing, open } = data;
  const closeHref = boardHref(listing.page);

  return (
    <main>
      <Notices data={data} />

      <section id="add" aria-labelledby="add-title" className="scroll-mt-24 border-b-[3px] border-line">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <h1 id="add-title" className="font-display text-5xl leading-[0.95] uppercase sm:text-7xl">
            How useful is your business?
          </h1>
          <p className="mt-4 max-w-2xl text-lg">
            Jev, an AI judge, reads your website, sums up what you do in plain English and scores how useful your business
            is from 1 to 1000. Every business lands on the public leaderboard below.
          </p>
          <JudgeForm className="mt-6 max-w-2xl" />
          <p className="-mt-2 text-sm text-ink-soft">$5, verdict in about a minute. You can't buy a better score.</p>

          <div className="mt-10 flex flex-wrap items-start gap-x-12 gap-y-6">
            <div>
              <p className="text-sm text-ink-soft">Businesses ranked</p>
              <p className="tabular text-3xl font-bold leading-tight">{formatCount(listing.total)}</p>
            </div>
            <ViewsTile label="Leaderboard views, last 30 days" days={data.boardViews} className="w-full max-w-xs" />
          </div>
        </div>
      </section>

      <section id="leaderboard" aria-labelledby="leaderboard-title" className="mx-auto max-w-5xl scroll-mt-24 px-4 pt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="leaderboard-title" className="font-display text-4xl uppercase sm:text-5xl">
            Leaderboard
          </h2>
          <p className="text-sm text-ink-soft">Ranked by usefulness. Click a business for the full verdict.</p>
        </div>

        <div className="slab mt-5 overflow-hidden">
          {listing.entries.length > 0 ? (
            <ol aria-label="Leaderboard">
              {listing.entries.map((entry) => (
                <BoardRow
                  key={entry.siteKey}
                  entry={entry}
                  details={open && open.entry.siteKey === entry.siteKey ? open : null}
                  closeHref={closeHref}
                  origin={data.origin}
                />
              ))}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="font-display text-3xl uppercase">No businesses yet</p>
              <a href="#add" onClick={focusJudgeInput} className={`btn px-5 py-3 ${focusRing}`}>
                Be the first · $5
              </a>
            </div>
          )}
        </div>

        <Pagination page={listing.page} count={Math.ceil(listing.total / listing.pageSize)} />
      </section>
    </main>
  );
}

function Notices({ data }: { data: BoardPageData }) {
  if (!data.checkoutCancelled && data.judging.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-5">
      {data.judging.map((order) => (
        <p key={order.id} className="slab flex flex-wrap items-center justify-between gap-3 bg-jev/20 px-4 py-3">
          <span>
            Jev is judging <strong>{order.siteKey}</strong> right now.
          </span>
          <Link to={`/judging/${order.id}`} className={`font-bold underline ${focusRing}`}>
            Watch
          </Link>
        </p>
      ))}
      {data.checkoutCancelled ? (
        <p className="slab flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span>
            Checkout cancelled{data.cancelledSite ? ` for ${data.cancelledSite}` : ""}. Nothing was charged.
          </span>
          <Link to="/" preventScrollReset className={`font-bold underline ${focusRing}`}>
            Dismiss
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Pagination({ page, count }: { page: number; count: number }) {
  if (count <= 1) return null;
  const step = `btn btn-ghost px-4 py-2 text-sm ${focusRing}`;
  return (
    <nav aria-label="Leaderboard pages" className="mt-5 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link to={`${boardHref(page - 1)}#leaderboard`} rel="prev" className={step}>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-ink-soft">
        Page {page} of {count}
      </span>
      {page < count ? (
        <Link to={`${boardHref(page + 1)}#leaderboard`} rel="next" className={step}>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
