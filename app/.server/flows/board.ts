import { isbot } from "isbot";
import { Effect, Option } from "effect";
import { IN_FLIGHT_STATUSES } from "../domain/models";
import { CurrentRequest } from "../http";
import { Board } from "../services/Board";
import { Orders } from "../services/Orders";
import { BOARD_VIEWS, Views } from "../services/Views";

export const PAGE_SIZE = 50;
/** Days in the views-over-time charts. */
export const VIEW_DAYS = 30;

/**
 * Everything the one-page board shows: the leaderboard, total views over
 * time, the buyer's in-flight judgments and, on /s/<site>, that business
 * opened in place (on the page where it ranks).
 *
 * A full page load counts one board view; opening a business counts one view
 * of that business (client-side opens included). Bots aren't counted.
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

  const details = open
    ? {
        judgment: (yield* board.judgments(open.id))[0] ?? null,
        views: yield* views.daily(open.siteKey, VIEW_DAYS),
        canRejudge: yield* orders.paidForSite(current.visitorId, open.siteKey),
      }
    : null;

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
    open: open && details ? { entry: open, ...details } : null,
    judging,
    checkoutCancelled: cancelledOrder !== null,
    cancelledSite,
    origin: current.origin,
  };
});

export type BoardData = Effect.Success<ReturnType<typeof loadBoard>>;
