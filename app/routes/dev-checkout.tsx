import { Effect } from "effect";
import { data, Form, redirect, useNavigation } from "react-router";
import { effectAction, effectLoader } from "~/.server/http";
import { Orders } from "~/.server/services/Orders";
import { Payments } from "~/.server/services/Payments";
import { JevFace } from "~/components/logo";
import { formatMoney } from "~/lib/format";
import type { Route } from "./+types/dev-checkout";

/**
 * /dev/checkout/:orderId — a fake hosted-checkout page used when Autumn isn't
 * configured, so the full buy → judge flow works locally. Returns 404 when
 * real payments are enabled.
 */

const notAvailable = () =>
  Effect.die(data({ error: "NotFound", message: "The checkout simulator is off: real payments are enabled." }, { status: 404 }));

/** Only same-origin paths are accepted as the return target. */
const safeReturn = (value: string | null, orderId: string): string => {
  const fallback = `/judging/${orderId}`;
  if (!value) return fallback;
  try {
    const url = new URL(value, "http://local");
    return url.pathname.startsWith("/judging/") ? url.pathname : fallback;
  } catch {
    return fallback;
  }
};

export const loader = effectLoader("dev-checkout", ({ params, request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    if (payments.kind !== "fake") return yield* notAvailable();
    const order = yield* (yield* Orders).get(params.orderId);
    return {
      order: { id: order.id, siteKey: order.siteKey, kind: order.kind, amountCents: order.amountCents, status: order.status },
      returnTo: safeReturn(new URL(request.url).searchParams.get("return"), order.id),
    };
  }),
);

export const action = effectAction("dev-checkout", ({ params, request }: Route.ActionArgs) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    if (payments.kind !== "fake" || !payments.simulatePayment) return yield* notAvailable();
    const order = yield* (yield* Orders).get(params.orderId);
    yield* payments.simulatePayment(order.id);
    return redirect(safeReturn(new URL(request.url).searchParams.get("return"), order.id));
  }),
);

export const meta: Route.MetaFunction = () => [{ title: "Simulated checkout | Jevboard" }, { name: "robots", content: "noindex" }];

export default function DevCheckout({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { order } = loaderData;
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <div className="panel p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <span className="tag">Simulated checkout</span>
          <JevFace size={44} />
        </div>
        <h1 className="headline mt-6 text-4xl">{order.kind === "reroll" ? "Rejudge" : "Add my business"}</h1>
        <p className="mt-1 text-lg text-soft">{order.siteKey}</p>
        <div className="mt-6 flex items-baseline justify-between border-t border-line pt-4">
          <span className="font-semibold">Total</span>
          <span className="font-display text-4xl font-bold">{formatMoney(order.amountCents)}</span>
        </div>
        <p className="mt-4 text-sm text-soft">
          No AUTUMN_SECRET_KEY is configured, so this page stands in for Stripe. No card, no money: pressing the button
          marks the order as paid.
        </p>
        {order.status === "pending_payment" ? (
          <>
            <Form method="post" className="mt-6">
              <button type="submit" className="btn h-14 w-full text-lg" disabled={navigation.state !== "idle"}>
                {navigation.state !== "idle" ? "Paying…" : `Pay ${formatMoney(order.amountCents)} (pretend)`}
              </button>
            </Form>
            <a href={`/?cancelled=${order.id}`} className="link mt-4 block text-center text-sm">
              Cancel and go back
            </a>
          </>
        ) : (
          <a href={loaderData.returnTo} className="btn mt-6 h-14 w-full text-lg">
            Already paid. See the verdict
          </a>
        )}
      </div>
    </main>
  );
}
