import { isbot } from "isbot";
import { Effect, Option } from "effect";
import { IN_FLIGHT_STATUSES } from "../domain/models";
import { CurrentRequest } from "../request";
import { Board } from "../services/Board";
import { Orders } from "../services/Orders";
import { RateLimiter } from "../services/RateLimiter";
import { BOARD_VIEWS, Views } from "../services/Views";

export const PAGE_SIZE = 50;
/** Days in the views-over-time charts. */
export const VIEW_DAYS = 30;

/**
 * Everything the one-page board shows: the leaderboard, total views over
 * time, the buyer's in-flight judgments and, on /s/<site>, that business
 * opened in place (on the page where it ranks).
 *
 * Every listed business comes with what its opened row shows (Jev's
 * reasoning, its views per day, whether this visitor may rejudge it), so the
 * browser opens and closes rows without asking the server again.
 *
 * A full page load counts one board view; loading /s/<site> counts one view of
 * that business (rows opened in the browser report theirs to /api/view).
 * Bots aren't counted.
 */
export const loadBoard = Effect.fn("loadBoard")(function* (openSiteKey: string | null) {
  const board = yield* Board;
  const orders = yield* Orders;
  const views = yield* Views;
  const current = yield* CurrentRequest;
  const search = current.url.searchParams;

  const open = openSiteKey === null ? null : yield* board.getBySiteKey(openSiteKey);
  const page = open ? Math.max(1, Math.ceil(open.rank / PAGE_SIZE)) : Math.max(1, Math.floor(Number(search.get("page"))) || 1);

  const headers = current.request.headers;
  if (!isbot(headers.get("user-agent") ?? "")) {
    const fullPageLoad = headers.get("sec-fetch-dest") === "document" || (headers.get("accept") ?? "").includes("text/html");
    yield* views.record([...(fullPageLoad ? [BOARD_VIEWS] : []), ...(open ? [open.siteKey] : [])]);
  }

  const listing = yield* board.page({ page, pageSize: PAGE_SIZE, sort: "rank" });
  const boardViews = yield* views.daily(BOARD_VIEWS, VIEW_DAYS);
  const siteKeys = listing.entries.map((entry) => entry.siteKey);
  const [reasoning, dailyViews, totalViews, paidSites] = yield* Effect.all(
    [
      board.reasoning(listing.entries.map((entry) => entry.id)),
      views.dailyMany(siteKeys, VIEW_DAYS),
      views.allTime([...siteKeys, BOARD_VIEWS]),
      orders.paidSites(current.visitorId),
    ],
    { concurrency: "unbounded" },
  );
  const paid = new Set(paidSites);
  const rows: Record<string, RowDetails> = Object.fromEntries(
    listing.entries.map((entry) => [
      entry.siteKey,
      {
        reasoning: reasoning.get(entry.id) ?? null,
        views: dailyViews.get(entry.siteKey) ?? [],
        totalViews: totalViews.get(entry.siteKey) ?? 0,
        canRejudge: paid.has(entry.siteKey),
      },
    ]),
  );

  // Judgments this visitor paid for that are still running, so a closed tab can find its way back.
  const judging = (yield* orders.recentForCustomer(current.visitorId, 5))
    .filter((order) => IN_FLIGHT_STATUSES.includes(order.status))
    .map((order) => ({ id: order.id, siteKey: order.siteKey }));

  // "?cancelled=<orderId>" comes back from checkout. Name the site only for the buyer who cancelled.
  const cancelledOrder = search.get("cancelled");
  let cancelledSite: string | null = null;
  if (cancelledOrder) {
    const order = yield* orders.find(cancelledOrder);
    if (Option.isSome(order) && order.value.customerId === current.visitorId) cancelledSite = order.value.siteKey;
  }

  return {
    listing,
    boardViews,
    /** Every view the board has had (the header's "Live" pill). */
    totalViews: totalViews.get(BOARD_VIEWS) ?? 0,
    /** What each listed business shows when opened, by site key. */
    rows,
    /** The business opened in place (/s/<site>), if any. */
    open,
    judging,
    checkoutCancelled: cancelledOrder !== null,
    cancelledSite,
    origin: current.origin,
  };
});

/** A listed business's opened row. */
export interface RowDetails {
  /** Why Jev ranked it where it is (its current verdict's reasoning). */
  readonly reasoning: string | null;
  /** Views per day over the last VIEW_DAYS days, the same days as `boardViews`; empty when nobody looked. */
  readonly views: ReadonlyArray<number>;
  /** Every view it has had. */
  readonly totalViews: number;
  /** This visitor paid for a judgment of it, so they see "Rejudge". */
  readonly canRejudge: boolean;
}

export type BoardData = Effect.Success<ReturnType<typeof loadBoard>>;

/**
 * A row opened in the browser (no page load) counts one view of that business,
 * like loading /s/<site> would. Unknown sites and bots aren't counted.
 */
export const recordRowView = Effect.fn("recordRowView")(function* (siteKey: string) {
  const current = yield* CurrentRequest;
  if (isbot(current.request.headers.get("user-agent") ?? "")) return;
  // A loop of beacons can't pump the counts: at most a few counted opens a minute per visitor and network.
  const limiter = yield* RateLimiter;
  const allowed = (yield* limiter.allow("visitor", `view:${current.visitorId}`)) && (yield* limiter.allow("ip", `view:${current.clientIp}`));
  if (!allowed) return;
  const entry = yield* (yield* Board).findBySiteKey(siteKey.trim().toLowerCase().slice(0, 300));
  if (Option.isSome(entry)) yield* (yield* Views).record([entry.value.siteKey]);
});
