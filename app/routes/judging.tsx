import { Effect } from "effect";
import { effectAction, effectLoader } from "~/.server/http";
import { loadJudging, retryOrder } from "~/.server/flows/judging";
import type { Route } from "./+types/judging";

export const loader = effectLoader("judging", ({ params }: Route.LoaderArgs) => loadJudging(params.orderId));

export const action = effectAction("judging.retry", ({ params }: Route.ActionArgs) =>
  Effect.map(retryOrder(params.orderId), (retried) => ({ retried })),
);

export default function Judging({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-display text-5xl">{loaderData.order.siteKey}</h1>
      <p>{loaderData.order.status} — {loaderData.order.stageDetail}</p>
    </main>
  );
}
