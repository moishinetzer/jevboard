import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { OrderStatus } from "~/.server/domain/models";
import { Favicon } from "~/components/ui";
import { timeAgo } from "~/lib/format";
import { focusRing } from "./shared";

interface MyOrder {
  readonly id: string;
  readonly siteKey: string;
  readonly status: OrderStatus;
  readonly kind: "new" | "reroll";
  readonly createdAt: number;
}

const STATUS: Record<OrderStatus, { label: string; tone: "live" | "done" | "fail" | "idle" }> = {
  pending_payment: { label: "Awaiting payment", tone: "idle" },
  paid: { label: "In the queue", tone: "live" },
  crawling: { label: "Jev is reading", tone: "live" },
  judging: { label: "Deliberating", tone: "live" },
  tiebreaking: { label: "In the Duel Pit ⚔️", tone: "live" },
  complete: { label: "Verdict is in", tone: "done" },
  failed: { label: "Jev tripped — free retry", tone: "fail" },
};

const TONE = {
  live: "bg-jev text-[#111110]",
  done: "bg-up text-white",
  fail: "bg-hot text-white",
  idle: "bg-paper-2 text-ink",
} as const;

const POLL_MS = 5000;

/**
 * "Your cases": the visitor's recent judgments (remembered by cookie), so a
 * buyer can always get back to an in-progress verdict. Refreshes itself
 * while anything is still being judged.
 */
export function MyJudgments({ orders, now }: { orders: ReadonlyArray<MyOrder>; now: number }) {
  const revalidator = useRevalidator();
  const inFlight = orders.some((order) => STATUS[order.status].tone === "live");

  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, revalidator]);

  if (orders.length === 0) return null;

  return (
    <section aria-labelledby="my-cases-title" className="slab-sm flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-center gap-2">
        <h2 id="my-cases-title" className="font-display text-2xl leading-none uppercase">
          Your cases
        </h2>
        {inFlight ? <span className="size-2 animate-blink rounded-full bg-hot" aria-hidden /> : null}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-2" aria-live="polite">
        {orders.map((order) => {
          const status = STATUS[order.status];
          return (
            <li key={order.id} className="min-w-0 max-w-full">
              <Link
                to={`/judging/${order.id}`}
                className={`flex min-w-0 items-center gap-2 border-2 border-line bg-card py-1 pr-1 pl-1.5 text-sm transition-transform hover:-translate-y-0.5 ${focusRing}`}
                title={`${order.kind === "reroll" ? "Retrial" : "Judgment"} ordered ${timeAgo(order.createdAt, now)}`}
              >
                <Favicon host={order.siteKey.split("/")[0]!} size={20} className="border!" />
                <span className="min-w-0 truncate font-mono text-xs font-bold">{order.siteKey}</span>
                {order.kind === "reroll" ? (
                  <span className="shrink-0 font-mono text-[10px] text-ink-soft uppercase">retrial</span>
                ) : null}
                <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap uppercase ${TONE[status.tone]}`}>
                  {status.tone === "live" ? "● " : ""}
                  {status.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Checkout cancelled. Jev remains unbothered." Dismissing drops ?cancelled
 * from the URL (a plain link, so it works without JS too).
 */
export function CancelledNotice({ siteKey, dismissHref }: { siteKey: string | null; dismissHref: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-[3px] border-[#111110] bg-hot p-3 text-white shadow-[4px_4px_0_var(--shadow)] sm:items-center"
    >
      <span className="text-2xl leading-none" aria-hidden>
        🧾
      </span>
      <p className="min-w-0 flex-1 text-sm sm:text-base">
        <strong className="font-display text-lg tracking-wide uppercase sm:text-xl">
          Checkout cancelled{siteKey ? ` for ${siteKey}` : ""}.
        </strong>{" "}
        Jev remains unbothered. No money moved — the form below still works whenever you find your courage.
      </p>
      <Link
        to={dismissHref}
        replace
        preventScrollReset
        onClick={() => setDismissed(true)}
        className={`grid size-9 shrink-0 place-items-center border-2 border-white text-xl leading-none font-bold hover:bg-white hover:text-hot ${focusRing}`}
        aria-label="Dismiss notice"
      >
        ×
      </Link>
    </div>
  );
}
