import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { ContentFlag, OrderStatus } from "~/.server/domain/models";
import type { JudgingView } from "~/.server/flows/judging";
import { JudgeForm } from "~/components/judge-form";
import { Crown, JevFace, MEDAL_TINT, medalFor } from "~/components/logo";
import { CONTACT_EMAIL } from "~/components/pages/faq/content";
import { CopyButton } from "~/components/verdict/copy-button";
import { ogPath } from "~/components/verdict/links";
import { shareMessage, xIntentUrl } from "~/components/verdict/share-copy";
import { formatCount } from "~/lib/format";
import { entryPath } from "~/lib/site-key";

type OrderView = JudgingView["order"];
type Result = NonNullable<JudgingView["result"]>;

/**
 * Re-runs the route loaders every `intervalMs` while `active`, pausing while
 * the tab is hidden and catching up as soon as it's visible again.
 */
export function usePolling(active: boolean, intervalMs = 1500) {
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      timer = undefined;
      if (cancelled || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await revalidate.current();
      } catch {
        // A blip (deploy, offline): try again on the next tick.
      } finally {
        running = false;
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && timer === undefined && !running) void tick();
    };

    timer = setTimeout(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, intervalMs]);
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const H1 = "headline mt-[18px] text-[40px] [overflow-wrap:anywhere] sm:text-[56px]";
const BIG_BUTTON = "h-[54px] px-[30px] text-base sm:text-[17px]";

const kindLabel = (order: OrderView): string => (order.kind === "reroll" ? "Rejudge" : "First judgment");

/** Pay → Jev reads → Verdict, with `at` the step in progress. */
function Stepper({ at }: { at: 0 | 1 }) {
  const steps = [at > 0 ? "Paid" : "Pay", "Jev reads", "Verdict"];
  return (
    <ol aria-label="Progress" className="mt-8 flex items-center gap-1.5 text-[13px] font-semibold sm:mt-9 sm:gap-2.5 sm:text-sm">
      {steps.map((label, index) => {
        const state = index < at ? "done" : index === at ? "active" : "todo";
        return (
          <li key={label} aria-current={state === "active" ? "step" : undefined} className="flex items-center gap-1.5 sm:gap-2.5">
            {index > 0 ? (
              <span aria-hidden className={`h-0.5 w-3 sm:w-7 ${state === "todo" ? "bg-line" : "bg-ink"}`} />
            ) : null}
            <span
              className={`flex items-center gap-2 rounded-full py-[7px] pr-3.5 pl-2 ${
                state === "active"
                  ? "bg-jev text-on-jev"
                  : state === "done"
                    ? "border-[1.5px] border-line bg-card"
                    : "border-[1.5px] border-line bg-card text-soft"
              }`}
            >
              <span
                aria-hidden
                className={`grid size-[22px] place-items-center rounded-full text-xs ${
                  state === "active" ? "bg-on-jev text-jev" : state === "done" ? "bg-ink text-card" : "bg-pill"
                }`}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              {label}
              <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Waiting for payment
// ---------------------------------------------------------------------------

export function AwaitingPayment({ order, simulated }: { order: OrderView; simulated: boolean }) {
  const returnTo = `/judging/${order.id}`;
  return (
    <>
      <span className="tag">
        {kindLabel(order)} · {order.siteKey}
      </span>
      <h1 className={H1}>
        Waiting for your <span className="text-accent">$5</span>
      </h1>
      <p className="mt-4 max-w-[520px] text-base leading-relaxed text-soft sm:text-[17px]">
        As soon as your payment lands, Jev starts reading {order.siteKey}. Just paid? This page updates by itself in a few
        seconds.
      </p>
      <Stepper at={0} />
      <p role="status" className="mt-8 flex items-center gap-2 text-sm font-medium text-soft">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        Checking with the payment desk…
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {simulated ? (
          <Link
            to={`/dev/checkout/${encodeURIComponent(order.id)}?return=${encodeURIComponent(returnTo)}`}
            className={`btn ${BIG_BUTTON}`}
          >
            Open the simulated checkout
          </Link>
        ) : null}
        <Link to="/#add" className={`btn btn-ghost ${BIG_BUTTON}`}>
          Use a different URL
        </Link>
      </div>
      <p className="mt-4 text-[13px] text-soft">Nothing is charged until checkout completes.</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Jev at work
// ---------------------------------------------------------------------------

const QUIPS: Partial<Record<OrderStatus, ReadonlyArray<string>>> = {
  paid: ["Finding the reading glasses…", "Cracking knuckles. Loudly.", "Clearing the docket…"],
  crawling: [
    "Reading your homepage…",
    "…and your pricing page. Hm.",
    "Counting the word “seamless”…",
    "Looking for a price. Any price.",
    "Squinting at the stock photos…",
    "Reading the footer. Yes, the footer.",
  ],
  judging: [
    "Deliberating.",
    "Weighing usefulness against vibes…",
    "Drafting the roast. Softening it. Un-softening it.",
    "Doing the math. Jev is bad at math. Jev is doing it anyway.",
  ],
  tiebreaking: ["Finding your spot on the board…", "Checking the neighbours…", "Almost there."],
};

const PROGRESS: Partial<Record<OrderStatus, number>> = { paid: 12, crawling: 35, judging: 65, tiebreaking: 90 };

function Quip({ status }: { status: OrderStatus }) {
  const lines = QUIPS[status] ?? QUIPS.judging!;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((current) => (current + 1) % lines.length), 2600);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <p
      aria-hidden
      className="rounded-2xl border-[1.5px] border-gold-line bg-gold-bg px-4 py-3 text-base font-semibold sm:mb-[30px] sm:rounded-[16px_16px_16px_4px] sm:text-left sm:text-[17px]"
    >
      {lines[index % lines.length]}
    </p>
  );
}

export function Working({
  order,
  current,
}: {
  order: OrderView;
  /** The entry as it stands before this judgment lands (rejudges only). */
  current: { readonly score: number; readonly rank: number } | null;
}) {
  // A paid order with an error is waiting out a retry; its detail says so.
  const detail =
    order.status === "paid" && order.error === null ? "Jev is on the way…" : (order.stageDetail ?? "Jev is on it…");
  const progress = PROGRESS[order.status] ?? 50;
  return (
    <>
      <span className="tag">{kindLabel(order)}</span>
      <h1 className={H1}>
        Jev is judging <span className="text-accent">{order.siteKey}</span>
      </h1>
      <Stepper at={1} />

      <section className="panel mt-8 flex w-full flex-col items-center px-5 pt-8 pb-7 sm:mt-10 sm:px-9 sm:pt-9 sm:pb-[30px]">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end">
          <JevFace size={112} label="Jev, reading" className="size-[84px] animate-bob sm:size-28" />
          <Quip key={order.status} status={order.status} />
        </div>
        <p role="status" aria-live="polite" className="mt-5 text-sm text-soft [overflow-wrap:anywhere]">
          {detail}
        </p>
        <div
          role="progressbar"
          aria-label="Judging progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-3.5 h-2 w-full max-w-[360px] overflow-hidden rounded-full bg-track"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
      </section>

      {order.kind === "reroll" && current ? (
        <p className="mt-5 text-sm text-soft">
          Right now it's #{current.rank} with {current.score}. It can go up. It can also go down.
        </p>
      ) : null}
      <p className="mt-4 text-sm leading-relaxed text-soft sm:mt-[22px]">
        Usually under a minute. You can close this tab: the verdict lands on the board either way.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const andList = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** "Scored 783, up from 740. Only OpenStreetMap and Linear rank higher." */
const standing = (result: Result): string => {
  const { judgment, entry, above, totalEntries } = result;
  const previous = judgment.previousScore;
  const scored =
    previous === null
      ? `Scored ${judgment.score}.`
      : previous === judgment.score
        ? `Scored ${judgment.score} again.`
        : `Scored ${judgment.score}, ${judgment.score > previous ? "up" : "down"} from ${previous}.`;
  if (!entry) return scored;
  const behind = totalEntries - entry.rank;
  const place =
    entry.rank === 1
      ? "Nobody ranks higher."
      : above.length > 0
        ? `Only ${andList(above)} ${above.length === 1 ? "ranks" : "rank"} higher.`
        : behind > 0
          ? `Ahead of ${formatCount(behind)} other ${behind === 1 ? "business" : "businesses"}.`
          : "Plenty of room to climb.";
  return `${scored} ${place}`;
};

/** "#3" in its medal pill with a crown for the top three, plain accent otherwise. */
function RankPill({ rank }: { rank: number }) {
  const medal = medalFor(rank);
  if (!medal) return <span className="text-accent">#{formatCount(rank)}</span>;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-2 pt-0 pr-4 pb-1 pl-3 align-middle text-accent sm:gap-2.5 sm:pr-[18px] sm:pl-3.5 ${MEDAL_TINT[medal]}`}
    >
      <Crown medal={medal} width={40} className="w-7 sm:w-10" />#{rank}
    </span>
  );
}

export function Verdict({ order, result, origin }: { order: OrderView; result: Result; origin: string }) {
  const { judgment, entry } = result;
  if (!entry) return <Declined order={order} flag={judgment.contentFlag} />;

  const url = `${origin}${entryPath(entry.siteKey)}`;
  const share = shareMessage({ siteKey: entry.siteKey, rank: entry.rank, total: result.totalEntries, url }, "defendant");

  return (
    <>
      <span className="tag bg-jev font-bold text-on-jev">Jev has spoken</span>
      <h1 className={`${H1} sm:text-6xl`}>
        {entry.siteKey} lands at <RankPill rank={entry.rank} />
      </h1>
      <p className="mt-[18px] text-base text-soft sm:text-lg">{standing(result)}</p>

      <section className="mt-8 w-full rounded-[22px] border border-line bg-card px-5 py-6 text-left sm:mt-9 sm:px-7 sm:py-[26px]">
        <p className="text-[13px] font-bold text-soft">What Jev says you do</p>
        <p className="mt-1.5 text-[17px] leading-normal sm:text-[19px]">{judgment.tldr}</p>
        <figure className="mt-5 flex items-start gap-3 rounded-[14px] border border-gold-line bg-gold-bg px-4 py-3.5">
          <JevFace size={32} label="Jev says" className="shrink-0" />
          <blockquote className="text-[15px] leading-normal italic sm:text-base">“{judgment.verdict}”</blockquote>
        </figure>
        {judgment.manipulationAttempt ? (
          <p className="mt-3 rounded-xl border border-bad/40 px-3 py-2 text-sm font-semibold text-bad">
            This site tried to give Jev instructions. Jev noticed and marked it down.
          </p>
        ) : null}
      </section>

      <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
        <Link to={entryPath(entry.siteKey)} className={`btn ${BIG_BUTTON}`}>
          See it on the board
        </Link>
        <a href={xIntentUrl(share.full)} target="_blank" rel="noopener" className={`btn btn-ghost ${BIG_BUTTON} px-[22px]`}>
          Share on X
        </a>
        <CopyButton text={url} label="Copy link" copiedLabel="Link copied" className={`btn btn-ghost ${BIG_BUTTON} px-[22px]`} />
      </div>

      <p className="mt-11 mb-2.5 text-[13px] font-semibold text-soft">What people see when you share it</p>
      <img
        src={ogPath(entry.siteKey)}
        width={600}
        height={315}
        alt={`Share card: ${entry.name}, #${entry.rank} on Ranked by Jev with ${judgment.score}`}
        className="aspect-[1200/630] w-full max-w-[600px] rounded-2xl border border-line bg-paper shadow-[0_8px_24px_rgba(29,27,22,0.08)]"
      />

      <p className="mt-[34px] text-[13px] text-soft">
        Changed your site later? Rejudge from your listing on the board for $5. The newest verdict stands.
      </p>
    </>
  );
}

const FLAG_COPY: Record<ContentFlag, string> = {
  parked: "It looks parked, for sale or still under construction. There's no business here for Jev to judge yet.",
  adult: "It looks like adult content, which Jev keeps off the public board.",
  illegal: "Something on it looked like it might break the law, so Jev is keeping it off the board.",
  scam: "Parts of it looked like a scam to Jev. Jev might be wrong, but the public board is no place to find out.",
  hateful: "Jev found content that targets people, and that stays off the board.",
  none: "Jev decided not to list it on the public board.",
};

/** Jev judged the site but won't put it on the public board. */
function Declined({ order, flag }: { order: OrderView; flag: ContentFlag }) {
  return (
    <>
      <span className="tag">No listing</span>
      <h1 className={H1}>
        Jev won't list <span className="text-accent">{order.siteKey}</span>
      </h1>
      <p className="mt-4 max-w-[540px] text-base leading-relaxed text-soft sm:text-[17px]">{FLAG_COPY[flag]}</p>
      <p className="mt-2 text-sm text-soft">It won't appear on the board. Jev reviews websites, not people.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        {flag === "parked" ? (
          <JudgeForm siteUrl={order.url} label="Launched since? Rejudge" buttonClassName={`btn ${BIG_BUTTON}`} />
        ) : null}
        <Link to="/" className={`btn btn-ghost ${BIG_BUTTON}`}>
          Back to the board
        </Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// No verdict
// ---------------------------------------------------------------------------

export function Failed({ order }: { order: OrderView }) {
  const paid = order.paidAt !== null;
  const refunded = order.refundState === "done";
  return (
    <>
      <span className="tag">
        No verdict{paid ? (refunded ? " · $5 refunded" : " · refund on its way") : ""}
      </span>
      <h1 className={H1}>
        Jev couldn't judge <span className="text-accent">{order.siteKey}</span>
      </h1>
      <p className="mt-4 max-w-[540px] text-base leading-relaxed text-soft sm:text-[17px]">
        {order.error ?? "Something went wrong inside Jev."} That isn't a verdict, so nothing lands on the board.
        {paid
          ? refunded
            ? " We've refunded your $5. Banks usually show it within 5 to 10 business days."
            : " We're refunding your $5 now."
          : ""}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5 sm:mt-9">
        <JudgeForm
          siteUrl={order.url}
          newSite={order.kind !== "reroll"}
          label="Try again"
          buttonClassName={`btn ${BIG_BUTTON}`}
        />
        <Link to="/" className={`btn btn-ghost ${BIG_BUTTON}`}>
          Back to the board
        </Link>
      </div>
      <p className="mt-4 text-[13px] text-soft [overflow-wrap:anywhere]">
        Check that {order.url} loads in a normal browser without a login before trying again.
        {paid ? (
          <>
            {" "}
            Refund questions?{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link">
              {CONTACT_EMAIL}
            </a>
          </>
        ) : null}
      </p>
    </>
  );
}
