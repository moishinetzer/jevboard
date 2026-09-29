import { Effect, Option } from "effect";
import { Link, useRouteLoaderData } from "react-router";
import { loadJudging, retryOrder } from "~/.server/flows/judging";
import { CurrentRequest, effectAction, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { JevFace } from "~/components/logo";
import {
  AwaitingPayment,
  Mistrial,
  ProgressRail,
  Theatre,
  usePolling,
} from "~/components/verdict/judging-theatre";
import { VerdictReveal } from "~/components/verdict/score-reveal";
import { entryPath } from "~/lib/site-key";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/judging";

export const loader = effectLoader("judging", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const view = yield* loadJudging(params.orderId);
    const { origin } = yield* CurrentRequest;
    // While a retrial is in flight, show what's at stake: the standing score.
    const standing = view.done ? Option.none() : yield* (yield* Board).findBySiteKey(view.order.siteKey);
    const current = Option.match(standing, {
      onNone: () => null,
      onSome: (entry) => ({ score: entry.score, rank: entry.rank }),
    });
    return { ...view, current, origin, now: Date.now() };
  }),
);

export const action = effectAction("judging.retry", ({ params }: Route.ActionArgs) =>
  Effect.map(retryOrder(params.orderId), (retried) => ({ retried })),
);

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteKey = loaderData?.order.siteKey;
  const status = loaderData?.order.status;
  const title = !siteKey
    ? "Judging — Jevboard"
    : status === "complete"
      ? `${siteKey} — Jev has spoken | Jevboard`
      : status === "failed"
        ? `${siteKey} — mistrial | Jevboard`
        : `${siteKey} — Jev is judging… | Jevboard`;
  return [{ title }, { name: "robots", content: "noindex, nofollow" }];
};

export default function Judging({ loaderData }: Route.ComponentProps) {
  const { order, steps, done, result, current, origin, now } = loaderData;
  const shell = useRouteLoaderData<typeof rootLoader>("root");
  usePolling(!done, 1500);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8 sm:mb-10">
        <p className="font-mono text-xs font-bold tracking-widest uppercase">
          <span className="bg-ink px-1.5 py-0.5 text-paper">{order.kind === "reroll" ? "Retrial" : "First judgment"}</span>
          <span className="ml-2 text-ink-soft">Case: Jev v.</span>
        </p>
        <h1 className="mt-2 font-display text-5xl leading-[0.9] uppercase [overflow-wrap:anywhere] sm:text-7xl">
          {order.siteKey}
        </h1>
      </header>

      <ProgressRail steps={steps} />

      <div className="mt-10">
        {order.status === "pending_payment" ? (
          <AwaitingPayment orderId={order.id} simulated={shell?.mode.payments === "fake"} />
        ) : order.status === "failed" ? (
          <Mistrial order={order} />
        ) : order.status === "complete" ? (
          result ? (
            <VerdictReveal order={order} result={result} origin={origin} />
          ) : (
            <VerdictMissing siteKey={order.siteKey} />
          )
        ) : (
          <Theatre order={order} current={order.kind === "reroll" ? current : null} now={now} />
        )}
      </div>
    </main>
  );
}

/** Complete, but the judgment row couldn't be loaded (shouldn't happen): point at the verdict page. */
function VerdictMissing({ siteKey }: { siteKey: string }) {
  return (
    <section className="slab flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
      <JevFace size={72} className="shrink-0" />
      <div>
        <h2 className="font-display text-4xl uppercase">Jev has spoken.</h2>
        <p className="mt-2 text-lg">The verdict is filed on the board.</p>
        <Link to={entryPath(siteKey)} className="btn mt-4 px-5 py-3">
          See the verdict →
        </Link>
      </div>
    </section>
  );
}
