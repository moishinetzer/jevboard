import { Effect, Option } from "effect";
import type { ShouldRevalidateFunction } from "react-router";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { BOARD_SORTS, Board as BoardService, type BoardSort } from "~/.server/services/Board";
import { Orders } from "~/.server/services/Orders";
import { Board } from "~/components/home/board";
import { ClosingCta } from "~/components/home/closing-cta";
import { FaqTeaser } from "~/components/home/faq-teaser";
import { Hero } from "~/components/home/hero";
import { HowItWorks } from "~/components/home/how-it-works";
import { LiveRefresh } from "~/components/home/live-refresh";
import { CancelledNotice, MyJudgments } from "~/components/home/my-judgments";
import { Podium } from "~/components/home/podium";
import { homeHref, SORT_TABS } from "~/components/home/shared";
import { VerdictSpread } from "~/components/home/verdict-spread";
import type { Route } from "./+types/home";

export const PAGE_SIZE = 50;

export const loader = effectLoader("home", ({ request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const board = yield* BoardService;
    const orders = yield* Orders;
    const current = yield* CurrentRequest;
    const search = new URL(request.url).searchParams;
    const sortParam = search.get("sort") ?? "rank";
    const sort: BoardSort = (BOARD_SORTS as ReadonlyArray<string>).includes(sortParam) ? (sortParam as BoardSort) : "rank";
    const page = Math.max(1, Math.floor(Number(search.get("page"))) || 1);
    const query = search.get("q")?.trim().slice(0, 100) ?? "";
    const category = search.get("category") ?? "";

    const listing = yield* board.page({ page, pageSize: PAGE_SIZE, query, category: category || undefined, sort });
    const podium = yield* board.top(3);
    const categories = yield* board.categories;
    const stats = yield* board.stats;
    const myOrders = (yield* orders.recentForCustomer(current.visitorId, 5)).map((order) => ({
      id: order.id,
      siteKey: order.siteKey,
      status: order.status,
      kind: order.kind,
      createdAt: order.createdAt,
    }));

    // "?cancelled=<orderId>" comes back from checkout. Name the site only for the buyer who cancelled.
    const cancelledOrder = search.get("cancelled");
    let cancelledSite: string | null = null;
    if (cancelledOrder) {
      const order = yield* orders.find(cancelledOrder);
      if (Option.isSome(order) && order.value.customerId === current.visitorId) cancelledSite = order.value.siteKey;
    }

    return {
      listing,
      podium,
      categories,
      histogram: stats.histogram,
      scoreStats: {
        entries: stats.entries,
        average: stats.averageScore,
        highest: stats.highestScore,
        lowest: stats.lowestScore,
        bribesCaught: stats.bribesCaught,
      },
      filters: { sort, page, query, category },
      myOrders,
      checkoutCancelled: cancelledOrder !== null,
      cancelledSite,
      origin: current.origin,
      now: Date.now(),
    };
  }),
);

/**
 * Skip reloading the board when nothing it shows can have changed:
 * - the $5 form posts to /judge (errors render inline; success leaves the page);
 * - dismissing the "checkout cancelled" notice only drops ?cancelled.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formAction, defaultShouldRevalidate }) => {
  if (formAction === "/judge") return false;
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.searchParams.has("cancelled") && !nextUrl.searchParams.has("cancelled")) {
    const before = new URLSearchParams(currentUrl.search);
    before.delete("cancelled");
    if (before.toString() === nextUrl.searchParams.toString()) return false;
  }
  return defaultShouldRevalidate;
};

const DESCRIPTION =
  "Paste your site. Pay $5. Jev crawls it, writes the TL;DR and rates how useful your business is from 1 to 1000. You can't buy #1 — you can only buy Jev's attention.";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const filters = loaderData?.filters;
  const king = loaderData?.podium[0];
  const tab = SORT_TABS.find((item) => item.sort === filters?.sort);
  const scope =
    filters?.query ? `“${filters.query}” on the board` : filters?.category ? `${filters.category} board` : tab && tab.sort !== "rank" ? `${tab.label} board` : null;
  const title = scope ? `${scope} — Jevboard` : "Jevboard — Pay $5. Get judged by Jev.";
  const description = king
    ? `${DESCRIPTION} Currently #1: ${king.name} at ${king.score}/1000, out of ${loaderData.scoreStats.entries} judged.`
    : DESCRIPTION;
  const origin = loaderData?.origin ?? "";
  const image = `${origin}/og.png`;

  return [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Jevboard" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: `${origin}/` },
    { property: "og:image", content: image },
    { property: "og:image:alt", content: "Jevboard: pay $5, get judged by Jev, the AI judge." },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "theme-color", content: "#ffd400" },
    { tagName: "link", rel: "canonical", href: `${origin}/` },
    ...(filters?.query ? [{ name: "robots", content: "noindex, follow" }] : []),
  ];
};

export default function Home({ loaderData }: Route.ComponentProps) {
  const { listing, podium, categories, histogram, scoreStats, filters, myOrders, checkoutCancelled, cancelledSite, origin, now } =
    loaderData;
  const king = podium[0] ? { siteKey: podium[0].siteKey, name: podium[0].name, host: podium[0].host } : null;
  const showNotices = checkoutCancelled || myOrders.length > 0;

  return (
    <main>
      {showNotices ? (
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 pt-5">
          {checkoutCancelled ? (
            <CancelledNotice siteKey={cancelledSite} dismissHref={homeHref(filters, { page: filters.page }, "")} />
          ) : null}
          <MyJudgments orders={myOrders} now={now} />
        </div>
      ) : null}

      <Hero king={king} />
      <Podium entries={podium} total={scoreStats.entries} origin={origin} />
      <Board listing={listing} filters={filters} categories={categories} now={now} />
      <HowItWorks bribesCaught={scoreStats.bribesCaught} />

      <div className="mx-auto mt-20 grid max-w-7xl gap-12 px-4 lg:grid-cols-2 lg:gap-10">
        <VerdictSpread histogram={histogram} stats={scoreStats} />
        <FaqTeaser />
      </div>

      <ClosingCta judged={scoreStats.entries} />
      <LiveRefresh kingSiteKey={king?.siteKey ?? null} />
    </main>
  );
}
