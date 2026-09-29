import { Effect } from "effect";
import { effectLoader } from "~/.server/http";
import { CurrentRequest } from "~/.server/http";
import { BOARD_SORTS, Board, type BoardSort } from "~/.server/services/Board";
import { Orders } from "~/.server/services/Orders";
import type { Route } from "./+types/home";

export const PAGE_SIZE = 50;

export const loader = effectLoader("home", ({ request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const board = yield* Board;
    const search = new URL(request.url).searchParams;
    const sortParam = search.get("sort") ?? "rank";
    const sort: BoardSort = (BOARD_SORTS as ReadonlyArray<string>).includes(sortParam) ? (sortParam as BoardSort) : "rank";
    const page = Math.max(1, Number(search.get("page")) || 1);
    const query = search.get("q")?.slice(0, 100) ?? "";
    const category = search.get("category") ?? "";

    const listing = yield* board.page({ page, pageSize: PAGE_SIZE, query, category: category || undefined, sort });
    const podium = yield* board.top(3);
    const categories = yield* board.categories;
    const stats = yield* board.stats;
    const visitorId = (yield* CurrentRequest).visitorId;
    const myOrders = (yield* (yield* Orders).recentForCustomer(visitorId, 5)).map((order) => ({
      id: order.id,
      siteKey: order.siteKey,
      status: order.status,
      kind: order.kind,
      createdAt: order.createdAt,
    }));
    const cancelledOrder = search.get("cancelled");

    return {
      listing,
      podium,
      categories,
      histogram: stats.histogram,
      filters: { sort, page, query, category },
      myOrders,
      checkoutCancelled: cancelledOrder !== null,
    };
  }),
);

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-6xl uppercase">Jevboard</h1>
      <pre className="text-xs">{JSON.stringify(loaderData.filters)}</pre>
    </main>
  );
}
