import { Effect } from "effect";
import { Link } from "react-router";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import {
  Bribers,
  DuelChampions,
  HallOfFame,
  PersistentDefendants,
  SwingList,
  toHallEntry,
  toSwing,
  WallOfShame,
} from "~/components/pages/hall/sections";
import { ThroneRoom } from "~/components/pages/hall/throne";
import { buildThroneHistory, isThroneEvent } from "~/components/pages/hall/throne-history";
import { pageMeta } from "~/components/pages/meta";
import { Exhibit, focusRing, JumpNav, PageMasthead } from "~/components/pages/shared";
import type { Route } from "./+types/hall";

/** How far back the event feed is read to rebuild the throne history. */
const THRONE_EVENT_WINDOW = 1000;

export const loader = effectLoader("hall", () =>
  Effect.gen(function* () {
    const board = yield* Board;
    const hall = yield* board.hall;
    const top = yield* board.top(10);
    const stats = yield* board.stats;
    const events = yield* board.events({ limit: THRONE_EVENT_WINDOW });
    const { origin } = yield* CurrentRequest;

    const throneEvents = events
      .filter(isThroneEvent)
      .map(({ id, kind, siteKey, otherSiteKey, score, createdAt }) => ({ id, kind, siteKey, otherSiteKey, score, createdAt }));

    return {
      origin,
      now: Date.now(),
      king: stats.king,
      throne: buildThroneHistory(throneEvents, stats.king),
      longest: hall.reigns,
      top: top.map(toHallEntry),
      lowest: hall.lowest.map(toHallEntry),
      jumps: hall.biggestJumps.map(toSwing),
      drops: hall.biggestDrops.map(toSwing),
      persistent: hall.mostRerolled.map(toHallEntry),
      bribers: hall.bribers.map(toHallEntry),
      champions: hall.duelChampions,
      totals: { entries: stats.entries, rerolls: stats.rerolls, duels: stats.duels, bribes: stats.bribesCaught },
    };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: "Hall of Fame & Shame",
    description:
      "Every king of Jevboard and how long they reigned, Jev's top 10, the wall of shame, the biggest retrial glow-ups and faceplants, and everyone caught trying to bribe Jev.",
    path: "/hall",
    origin: loaderData?.origin,
  });

const SECTIONS = [
  { id: "throne", label: "The Throne" },
  { id: "fame", label: "Hall of Fame" },
  { id: "shame", label: "Wall of Shame" },
  { id: "retrials", label: "Retrial roulette" },
  { id: "persistent", label: "Persistent defendants" },
  { id: "bribes", label: "Caught bribing" },
  { id: "duels", label: "Duel Pit" },
] as const;

export default function Hall({ loaderData }: Route.ComponentProps) {
  const data = loaderData;
  return (
    <main>
      <PageMasthead
        kicker="The permanent record"
        title={
          <>
            Hall of <span className="highlight">Fame</span> &amp; Shame
          </>
        }
        aside={
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs font-bold uppercase sm:grid-cols-4 lg:grid-cols-2">
            {[
              ["Defendants", data.totals.entries],
              ["Retrials", data.totals.rerolls],
              ["Duels", data.totals.duels],
              ["Bribes caught", data.totals.bribes],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="score-num text-4xl">{value}</dd>
              </div>
            ))}
          </dl>
        }
      >
        Every king, every clown, every $5 that went horribly wrong. Jev forgets nothing (except you, between retrials).
      </PageMasthead>

      <JumpNav items={SECTIONS} label="Hall sections" />

      <div className="mx-auto flex max-w-7xl flex-col gap-16 px-4 pt-10">
        <Exhibit
          id="throne"
          letter="A"
          title="The Throne"
          blurb="Like King of the Ether's History of the Throne, minus the blockchain. Every #1 Jev has crowned, how long they lasted and who took it from them."
        >
          <ThroneRoom king={data.king} reigns={data.throne} longest={data.longest} serverNow={data.now} />
        </Exhibit>

        <Exhibit id="fame" letter="B" title="Hall of Fame" blurb="Jev's all-time top 10. Earned, not bought. Every one of them paid exactly $5 per verdict.">
          <HallOfFame entries={data.top} />
        </Exhibit>

        <Exhibit
          id="shame"
          letter="C"
          title={
            <>
              Jev's lowest <span className="text-hot">·</span> Wall of Shame
            </>
          }
          blurb="The bottom of the docket. Jev roasts websites, never people. You can always demand a retrial."
        >
          <WallOfShame entries={data.lowest} />
        </Exhibit>

        <Exhibit
          id="retrials"
          letter="D"
          title="Retrial roulette"
          blurb="Every retrial is judged from scratch and the newest verdict stands, even when it's lower. These are the biggest swings."
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SwingList swings={data.jumps} direction="up" now={data.now} />
            <SwingList swings={data.drops} direction="down" now={data.now} />
          </div>
        </Exhibit>

        <Exhibit
          id="persistent"
          letter="E"
          title="Most persistent defendants"
          blurb="Most judgments per site, and what it cost them at $5 a pop. The bar shows their worst to best score; the red tick is where they stand now."
        >
          <PersistentDefendants entries={data.persistent} />
        </Exhibit>

        <Exhibit
          id="bribes"
          letter="F"
          title="Caught bribing Jev"
          blurb="Sites whose pages tried to instruct, flatter or bribe an AI judge. Jev keeps a list. This is the list."
        >
          <Bribers entries={data.bribers} now={data.now} />
        </Exhibit>

        <Exhibit
          id="duels"
          letter="G"
          title="Duel Pit champions"
          blurb="Exact-score ties are settled head-to-head. No draws. These sites have won the most tiebreaks."
        >
          <DuelChampions champions={data.champions} />
        </Exhibit>

        <aside className="slab flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-3xl uppercase leading-tight sm:text-4xl">Want a place in history?</p>
          <Link to="/#judge" className={`btn px-6 py-3 text-lg ${focusRing}`}>
            Get judged — $5
          </Link>
        </aside>
      </div>
    </main>
  );
}
