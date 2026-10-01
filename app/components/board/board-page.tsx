import { useEffect } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { BoardData } from "~/.server/flows/board";
import { DEFAULT_VARIANTS, FLAGS } from "~/lib/experiments";
import { reportExposure } from "~/components/analytics";
import type { Pricing } from "~/components/price-cta";
import type { loader as rootLoader } from "~/root";
import { JudgeForm } from "~/components/judge-form";
import { HomeHeader } from "~/components/shell";
import { formatCount } from "~/lib/format";
import { BoardRow } from "./board-row";
import { rememberBoard } from "./cache";
import { boardHref, focusJudgeInput } from "./shared";

/** What the one-page board needs (the loader data of `/` and `/s/<site>`). */
export type BoardPageData = BoardData;

/**
 * The whole site on one page: the pitch and the $5 form, then the board.
 * Opening a business expands it in place.
 */
export function BoardPage({ data }: { data: BoardPageData }) {
  const { listing, open } = data;
  const closeHref = boardHref(listing.page);
  const days = data.boardViews.map((day) => day.day);

  useEffect(() => rememberBoard(data), [data]);

  // Both live tests show up in the hero: the price around the button, and where the button leads.
  const shell = useRouteLoaderData<typeof rootLoader>("root");
  const experiments = shell?.experiments ?? DEFAULT_VARIANTS;
  const pricing: Pricing = { variant: experiments.price, wallet: shell?.wallet ?? "card", views: data.totalViews };
  useEffect(() => {
    reportExposure(FLAGS.onboarding, experiments.assigned.onboarding);
    reportExposure(FLAGS.price, experiments.assigned.price);
  }, [experiments]);

  return (
    <>
      <HomeHeader views={data.totalViews} ranked={listing.total} />
      <main className="flex w-full flex-col items-center px-4">
        <Notices data={data} />

        <section id="add" className="flex w-full max-w-[760px] scroll-mt-6 flex-col items-center pt-[22px] text-center sm:pt-7">
          <p className="max-w-[620px] text-[15px] leading-[1.55] text-soft sm:text-lg">
            <b className="font-bold">No bidding, no ads, no buying your way up.</b>
            <br />
            Jev reads your site and ranks how useful your business really is.
          </p>
          <h1 className="headline mt-[22px] text-[40px] sm:mt-[30px] sm:text-6xl">
            Think you're #1?
            <br />
            <span className="text-accent">Jev will be the judge.</span>
          </h1>
          <JudgeForm className="mt-5 w-full sm:mt-[26px]" pricing={pricing} guided={experiments.onboarding === "guided"} />
        </section>

        <section
          id="board"
          aria-label="The board"
          className="panel mt-9 w-full max-w-[780px] scroll-mt-6 rounded-[22px] p-2 sm:mt-[52px] sm:rounded-[26px] sm:p-3"
        >
          {listing.entries.length > 0 ? (
            <ol className="flex flex-col gap-1.5 sm:gap-2">
              {listing.entries.map((entry, index) => (
                <BoardRow
                  key={entry.siteKey}
                  entry={entry}
                  details={data.rows[entry.siteKey] ?? null}
                  days={days}
                  open={open?.siteKey === entry.siteKey}
                  closeHref={closeHref}
                  first={index === 0}
                />
              ))}
            </ol>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <p className="font-display text-2xl font-bold">Nobody's on the board yet.</p>
              <p className="text-soft">The first business Jev judges takes #1.</p>
              <a href="#add" onClick={focusJudgeInput} className="btn mt-3 h-12 px-6">
                Be the first
              </a>
            </div>
          )}
        </section>

        <Pagination listing={listing} />
      </main>
    </>
  );
}

function Notices({ data }: { data: BoardPageData }) {
  if (!data.checkoutCancelled && data.judging.length === 0) return null;
  const notice = "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-line bg-card px-4 py-3 text-left text-sm";
  return (
    <div className="mt-6 flex w-full max-w-[760px] flex-col gap-2">
      {data.judging.map((order) => (
        <p key={order.id} className={notice}>
          <span>
            Jev is judging <strong>{order.siteKey}</strong> right now.
          </span>
          <Link to={`/judging/${order.id}`} className="link">
            Watch
          </Link>
        </p>
      ))}
      {data.checkoutCancelled ? (
        <p className={notice}>
          <span>
            Checkout cancelled{data.cancelledSite ? ` for ${data.cancelledSite}` : ""}. Nothing was charged.
          </span>
          <Link to="/" preventScrollReset className="link">
            Dismiss
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Pagination({ listing }: { listing: BoardPageData["listing"] }) {
  const { page, pageSize, total, entries } = listing;
  if (total === 0) return null;
  const count = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = from + entries.length - 1;
  const step = "btn btn-ghost h-10 px-4 text-sm";
  return (
    <nav aria-label="Board pages" className="mt-3.5 flex w-full max-w-[780px] items-center justify-between gap-3 sm:mt-[18px]">
      {page > 1 ? (
        <Link to={`${boardHref(page - 1)}#board`} rel="prev" className={step}>
          <span aria-hidden>←</span> Previous
        </Link>
      ) : (
        <span />
      )}
      <p className="text-xs text-soft sm:text-[13px]">
        Showing {formatCount(from)}–{formatCount(to)} of {formatCount(total)}
      </p>
      {page < count ? (
        <Link to={`${boardHref(page + 1)}#board`} rel="next" className={step}>
          Next <span aria-hidden>→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
