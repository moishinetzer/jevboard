import { Effect } from "effect";
import { Link } from "react-router";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { useLive, useNow } from "~/components/live";
import { pageMeta } from "~/components/pages/meta";
import { focusRing, formatDate, formatDateTime, PageMasthead } from "~/components/pages/shared";
import { DailyCharts } from "~/components/pages/stats/daily-chart";
import { CategoryBars, ScoreSummary, StatTile, TileGrid } from "~/components/pages/stats/sections";
import { formatCount, formatDuration, formatMoney, JUDGMENT_PRICE_CENTS } from "~/lib/format";
import type { Route } from "./+types/stats";

export const loader = effectLoader("stats", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    const stats = yield* board.stats;
    const daily = yield* board.daily(30);
    const categories = yield* board.categories;
    const { origin } = yield* CurrentRequest;
    return { stats, daily, categories, origin, now: Date.now() };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: "Receipts",
    description: loaderData
      ? `Jev has been fed ${formatMoney(loaderData.stats.revenueCents)} across ${formatCount(loaderData.stats.judgments)} judgments. Every number on Jevboard, straight from the database: revenue, verdicts, retrials, duels and scores.`
      : "Every number on Jevboard, straight from the database: revenue, verdicts, retrials, duels and scores.",
    path: "/stats",
    origin: loaderData?.origin,
  });

export default function Stats({ loaderData }: Route.ComponentProps) {
  const { stats, daily, categories } = loaderData;
  const { counters } = useLive();
  const now = useNow(60_000, loaderData.now);

  // Live counters refresh every few seconds; the rest is as of page load.
  const revenueCents = Math.max(counters.revenueCents, stats.revenueCents);
  const judgments = Math.max(counters.judgments, stats.judgments);
  const rerolls = Math.max(counters.rerolls, stats.rerolls);
  const entries = counters.entries || stats.entries;
  const visitors = Math.max(counters.visitors, stats.visitors);
  const launchedAt = counters.launchedAt ?? stats.launchedAt;
  const windowRevenue = daily.reduce((sum, day) => sum + day.revenueCents, 0);
  const perJudgment = judgments > 0 ? revenueCents / judgments : JUDGMENT_PRICE_CENTS;

  return (
    <main>
      <PageMasthead
        kicker="Build in public · straight from the database"
        title={
          <>
            The <span className="highlight">Receipts</span>
          </>
        }
        aside={
          <div className="slab-sm max-w-xs p-4 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Open for judgment since</p>
            <p className="mt-1 font-display text-2xl uppercase leading-tight">{launchedAt ? formatDate(launchedAt) : "Not yet"}</p>
            <p className="mt-1 text-ink-soft" suppressHydrationWarning>
              {launchedAt ? `${formatDuration(now - launchedAt)} ago · first paid order ${formatDateTime(launchedAt)}` : "Waiting for the first $5."}
            </p>
          </div>
        }
      >
        Every dollar fed to Jev, every verdict, every retrial. No projections, no "annualized run-rate". Just the receipts.
      </PageMasthead>

      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-4 pt-10">
        <section aria-labelledby="revenue-title" className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="revenue-title" className="font-display uppercase">
              <span className="inline-block -rotate-1 border-[3px] border-[#111110] bg-jev px-3 pt-2 pb-1 text-7xl leading-none text-[#111110] shadow-[6px_6px_0_var(--shadow)] sm:text-9xl">
                {formatMoney(revenueCents)}
              </span>
              <span className="mt-4 block text-4xl leading-none sm:text-5xl">fed to Jev</span>
            </h2>
            <p className="mt-4 max-w-xl text-lg text-ink-soft">
              Across <strong className="text-ink">{formatCount(judgments)}</strong> judgments of{" "}
              <strong className="text-ink">{formatCount(entries)}</strong> defendants. That's{" "}
              {formatMoney(Math.round(perJudgment))} per verdict, because every verdict costs exactly{" "}
              {formatMoney(JUDGMENT_PRICE_CENTS)}. Nobody can pay more. Many have tried to pay again.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <p className="flex items-center gap-2 border-2 border-line bg-card px-3 py-1.5 text-sm font-bold">
              <span className="relative flex size-2.5">
                {counters.judgingNow > 0 ? (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-75" />
                ) : null}
                <span className={`relative inline-flex size-2.5 rounded-full ${counters.judgingNow > 0 ? "bg-hot" : "bg-ink-soft"}`} />
              </span>
              {counters.judgingNow > 0
                ? `Jev is judging ${formatCount(counters.judgingNow)} site${counters.judgingNow === 1 ? "" : "s"} right now`
                : "Jev is idle. Suspiciously idle."}
            </p>
            <Link to="/#judge" className={`btn px-5 py-3 ${focusRing}`}>
              Add to the receipts — $5
            </Link>
          </div>
        </section>

        <section aria-labelledby="counters-title">
          <h2 id="counters-title" className="sr-only">
            Counters
          </h2>
          <TileGrid>
            <StatTile label="Judgments" value={formatCount(judgments)} note="Each one a crawl, a TL;DR and a verdict." accent />
            <StatTile label="First judgments" value={formatCount(judgments - rerolls)} note="Sites brave enough to ask once." />
            <StatTile label="Retrials" value={formatCount(rerolls)} note="“Jev, look again.” Jev looked again." />
            <StatTile label="Defendants" value={formatCount(entries)} note="Sites currently on the board." />
            <StatTile label="Duels fought" value={formatCount(stats.duels)} note="Exact-score ties settled head-to-head." />
            <StatTile label="Bribes caught" value={formatCount(stats.bribesCaught)} note="Hidden instructions for Jev. Jev noticed." />
            <StatTile label="Visitors" value={formatCount(visitors)} note="Unique browsers. Mostly spectators." />
            <StatTile label="Clicks sent" value={formatCount(stats.clicksSent)} note="Visitors Jev sent to defendants' sites." />
          </TileGrid>
        </section>

        <section aria-labelledby="daily-title" className="slab p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2 border-b-[3px] border-line pb-3">
            <h2 id="daily-title" className="font-display text-4xl uppercase leading-none">
              The last 30 days
            </h2>
            <p className="font-mono text-xs font-bold uppercase text-ink-soft">UTC days · hover or use ← → to inspect</p>
          </div>
          <DailyCharts days={daily} revenueBeforeCents={Math.max(0, stats.revenueCents - windowRevenue)} />
        </section>

        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <section aria-labelledby="scores-title" className="slab p-4 sm:p-6">
            <h2 id="scores-title" className="font-display text-4xl uppercase leading-none">
              Score distribution
            </h2>
            <p className="mt-1 mb-5 text-sm text-ink-soft">Jev uses the whole 1–1000 scale. Grudgingly.</p>
            <ScoreSummary
              histogram={stats.histogram}
              average={stats.averageScore}
              highest={stats.highestScore}
              lowest={stats.lowestScore}
            />
          </section>
          <section aria-labelledby="categories-title" className="slab p-4 sm:p-6">
            <h2 id="categories-title" className="font-display text-4xl uppercase leading-none">
              The docket by category
            </h2>
            <p className="mt-1 mb-5 text-sm text-ink-soft">Jev files every defendant under exactly one. Nobody gets to pick.</p>
            <CategoryBars categories={categories} />
          </section>
        </div>

        <section aria-labelledby="fine-print-title" className="border-t-[3px] border-line pt-6">
          <h2 id="fine-print-title" className="font-display text-3xl uppercase">
            The fine print
          </h2>
          <dl className="mt-4 grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2">
            {[
              ["Revenue", "The sum of paid orders ($5 each), before payment-processor fees and before Jev's own API bill."],
              ["Judgments", "Every verdict Jev has delivered, including retrials and verdicts on sites later hidden for their content."],
              ["Visitors", "Unique browsers, counted by an anonymous cookie. No accounts, no fingerprinting."],
              ["Clicks sent", "Outbound visits through the board's links to a defendant's website."],
              ["Scores & categories", "Only sites currently on the public board; flagged sites are left out."],
              ["Freshness", "Totals at the top refresh live every few seconds. Everything else is as of when you opened the page."],
            ].map(([term, definition]) => (
              <div key={term}>
                <dt className="font-bold">{term}</dt>
                <dd className="text-ink-soft">{definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
