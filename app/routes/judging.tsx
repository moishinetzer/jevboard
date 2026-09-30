import { Effect, Option } from "effect";
import { Link, useRouteLoaderData } from "react-router";
import { loadJudging } from "~/.server/flows/judging";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { AwaitingPayment, Failed, usePolling, Verdict, Working } from "~/components/judging";
import { PageHeader } from "~/components/shell";
import { entryPath } from "~/lib/site-key";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/judging";

export const loader = effectLoader("judging", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const view = yield* loadJudging(params.orderId);
    const { origin } = yield* CurrentRequest;
    // While a rejudge is in flight, show what's at stake: where it stands now.
    const standing = view.done ? Option.none() : yield* (yield* Board).findBySiteKey(view.order.siteKey);
    const current = Option.match(standing, {
      onNone: () => null,
      onSome: (entry) => ({ score: entry.score, rank: entry.rank }),
    });
    return { ...view, current, origin };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteKey = loaderData?.order.siteKey;
  const status = loaderData?.order.status;
  const title = !siteKey
    ? "Judging | Jevboard"
    : status === "complete"
      ? `${siteKey}: Jev has spoken | Jevboard`
      : status === "failed"
        ? `${siteKey}: no verdict | Jevboard`
        : `${siteKey}: Jev is judging | Jevboard`;
  return [{ title }, { name: "robots", content: "noindex, nofollow" }];
};

export default function Judging({ loaderData }: Route.ComponentProps) {
  const { order, done, result, current, origin } = loaderData;
  const shell = useRouteLoaderData<typeof rootLoader>("root");
  usePolling(!done, 1500);

  return (
    <>
      <PageHeader />
      <main
        className={`mx-auto flex w-full flex-col items-center px-4 text-center ${
          order.status === "complete" ? "max-w-[700px] pt-12 sm:pt-16" : "max-w-[680px] pt-14 sm:pt-[90px]"
        }`}
      >
        <p role="status" className="sr-only">
          {announcement(loaderData)}
        </p>
        {order.status === "pending_payment" ? (
          <AwaitingPayment order={order} simulated={shell?.mode.payments === "fake"} />
        ) : order.status === "failed" ? (
          <Failed order={order} />
        ) : order.status === "complete" ? (
          result ? (
            <Verdict order={order} result={result} origin={origin} />
          ) : (
            <VerdictMissing siteKey={order.siteKey} />
          )
        ) : (
          <Working order={order} current={order.kind === "reroll" ? current : null} />
        )}
      </main>
    </>
  );
}

/** One line for screen readers when the judgment finishes (the page narrates the steps before that). */
const announcement = ({ order, result }: Route.ComponentProps["loaderData"]): string => {
  if (order.status === "failed") return `No verdict: ${order.error ?? "Jev couldn't finish."}`;
  if (order.status !== "complete" || !result) return "";
  if (!result.entry) return "Jev declined to list this site.";
  return `Jev has spoken: ${order.siteKey} is #${result.entry.rank} of ${result.totalEntries}, with ${result.judgment.score}.`;
};

/** Complete, but the judgment row couldn't be loaded (shouldn't happen): point at the board. */
function VerdictMissing({ siteKey }: { siteKey: string }) {
  return (
    <>
      <span className="tag bg-jev font-bold text-on-jev">Jev has spoken</span>
      <h1 className="headline mt-[18px] text-[40px] [overflow-wrap:anywhere] sm:text-[56px]">The verdict is on the board</h1>
      <Link to={entryPath(siteKey)} className="btn mt-8 h-[54px] px-[30px] text-[17px]">
        See it on the board
      </Link>
    </>
  );
}
