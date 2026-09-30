import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import type { OrderStatus } from "~/.server/domain/models";
import type { JudgingView } from "~/.server/flows/judging";
import { useNow } from "~/components/live";
import { JevFace } from "~/components/logo";
import { Favicon } from "~/components/ui";
import "./verdict.css";

type Step = JudgingView["steps"][number];
type OrderView = JudgingView["order"];

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
// Progress rail
// ---------------------------------------------------------------------------

const STEP_STYLE: Record<Step["state"], string> = {
  done: "bg-ink text-paper",
  active: "bg-jev text-[#111110] shadow-[3px_3px_0_var(--shadow)]",
  todo: "border-dashed bg-card text-ink-soft",
  failed: "bg-hot text-[#111110]",
};
const STEP_SR: Record<Step["state"], string> = {
  done: "done",
  active: "in progress",
  todo: "not started",
  failed: "failed",
};

export function ProgressRail({ steps }: { steps: ReadonlyArray<Step> }) {
  return (
    <ol aria-label="Judging progress" className="grid grid-cols-5">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === "active" ? "step" : undefined}
          className="relative flex flex-col items-center text-center"
        >
          {index > 0 ? (
            <span
              aria-hidden
              className={`absolute top-[22px] right-1/2 h-[5px] w-full -translate-y-1/2 sm:top-[28px] ${
                step.state === "todo" ? "bg-line/15" : "bg-line"
              }`}
            />
          ) : null}
          <span className="relative z-10">
            {step.state === "active" ? (
              <span aria-hidden className="jev-throb absolute -inset-2 border-[3px] border-hot" />
            ) : null}
            <span
              className={`relative grid size-11 place-items-center border-[3px] border-line font-display text-xl sm:size-14 sm:text-2xl ${STEP_STYLE[step.state]}`}
            >
              {step.state === "done" ? "✓" : step.state === "failed" ? "✗" : index + 1}
            </span>
          </span>
          <span className="mt-2 text-[10px] font-bold tracking-wide uppercase sm:text-xs">{step.label}</span>
          <span className="sr-only"> ({STEP_SR[step.state]})</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The theatre: what the buyer watches while Jev works
// ---------------------------------------------------------------------------

const QUIPS: Partial<Record<OrderStatus, ReadonlyArray<string>>> = {
  paid: ["Clearing the docket…", "Cracking knuckles. Loudly.", "Finding the reading glasses…"],
  crawling: [
    "Jev is reading your homepage…",
    "…and your pricing page. Hm.",
    "Jev has concerns about your hero gradient.",
    "Counting the word 'seamless'…",
    "Looking for a price. Any price.",
    "Found a 'Book a demo' button. Jev is disappointed.",
    "Squinting at the stock photos…",
    "Reading the footer. Yes, the footer.",
  ],
  judging: [
    "Deliberating.",
    "Counting buzzwords: 14",
    "Weighing usefulness against vibes…",
    "Consulting the bench. The bench is also Jev.",
    "Drafting the roast. Softening it. Un-softening it.",
    "Comparing you to every other defendant…",
    "Doing the math. Jev is bad at math. Jev is doing it anyway.",
  ],
  tiebreaking: [
    "Both parties, approach the bench.",
    "Sharpening the gavel…",
    "No coin flips. Jev re-reads both sites.",
    "Somebody is about to lose on a technicality.",
  ],
};

const HEADLINES: Partial<Record<OrderStatus, string>> = {
  paid: "Jev is putting on the robe",
  crawling: "Jev is reading your site",
  judging: "Jev is deliberating",
  tiebreaking: "Finding its place on the board",
};

interface DuelInProgress {
  readonly score: number;
  readonly duel: { readonly n: number; readonly of: number; readonly a: string; readonly b: string } | null;
}

/** Recognises the Pipeline's tie lines: "812 = 812. Jev doesn't do draws…" and "⚔️ Duel 2 of ~3: a vs b (both 812)". */
export const parseDuelDetail = (detail: string | null): DuelInProgress | null => {
  if (!detail) return null;
  const duel = /Duel (\d+) of ~?(\d+): (.+?) vs (.+?) \(both (\d+)\)/.exec(detail);
  if (duel) {
    return { score: Number(duel[5]), duel: { n: Number(duel[1]), of: Number(duel[2]), a: duel[3]!, b: duel[4]! } };
  }
  const tie = /^(\d+) = \1\b/.exec(detail);
  return tie ? { score: Number(tie[1]), duel: null } : null;
};

const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

function Quips({ status }: { status: OrderStatus }) {
  const lines = QUIPS[status] ?? QUIPS.judging!;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((current) => (current + 1) % lines.length), 2600);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <p aria-hidden className="min-h-7 text-lg text-[#fbf6e7]/75 italic sm:text-xl">
      <span key={index} className="jev-rise inline-block">
        {lines[index % lines.length]}
      </span>
    </p>
  );
}

export function Theatre({
  order,
  current,
  now,
}: {
  order: OrderView;
  /** The entry as it stands before this judgment lands (rerolls only). */
  current: { readonly score: number; readonly rank: number } | null;
  now: number;
}) {
  const ticking = useNow(1000, now);
  const startedAt = order.paidAt ?? order.createdAt;
  const pit = order.status === "tiebreaking" ? parseDuelDetail(order.stageDetail) : null;

  return (
    <section
      aria-labelledby="theatre-title"
      className="slab relative overflow-hidden border-line bg-[#111110]! text-[#fbf6e7]"
    >
      <div
        aria-hidden
        className="jev-spotlight pointer-events-none absolute -inset-x-1/4 inset-y-0 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(255,212,0,0.28),transparent_62%)]"
      />
      <div className="relative p-5 sm:p-8">
        <div className="flex items-center justify-between gap-3 font-mono text-[11px] font-bold tracking-widest uppercase">
          <span className="flex items-center gap-2">
            <span className="size-2.5 animate-blink rounded-full bg-hot" aria-hidden />
            Live from the bench
          </span>
          <span className="tabular">
            <span aria-hidden>⏱ </span>
            {clock(ticking - startedAt)}
            <span className="sr-only"> elapsed</span>
          </span>
        </div>

        {pit ? <DuelPitStage pit={pit} /> : <JudgeStage headline={HEADLINES[order.status] ?? "Jev is working"} />}

        <p
          role="status"
          aria-live="polite"
          className="mt-8 border-y-2 border-dashed border-[#fbf6e7]/30 py-4 font-mono text-base font-bold text-jev sm:text-xl [overflow-wrap:anywhere]"
        >
          {order.stageDetail ?? "Jev is on it…"}
          <span
            aria-hidden
            className="ml-1 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-blink bg-jev"
          />
        </p>
        <div className="mt-4">
          <Quips key={order.status} status={order.status} />
        </div>

        {order.kind === "reroll" && current ? (
          <p className="mt-6 text-base">
            Currently <span className="score-num text-2xl text-jev">{current.score}</span>/1000 · #{current.rank}. It
            can go up. <span className="font-bold">It can also go down.</span>
          </p>
        ) : null}
        <p className="mt-4 text-sm text-[#fbf6e7]/65">
          You can close this tab — Jev keeps working, and the verdict lands on{" "}
          <span className="font-bold">{order.siteKey}</span>'s page either way.
        </p>
      </div>
    </section>
  );
}

function JudgeStage({ headline }: { headline: string }) {
  return (
    <div className="mt-8 flex flex-col items-center text-center">
      <div className="relative">
        <JevFace size={132} className="animate-wiggle" />
        <span aria-hidden className="absolute -right-8 bottom-2 rotate-12 text-4xl">
          🔍
        </span>
      </div>
      <h2 id="theatre-title" className="mt-6 font-display text-4xl leading-none uppercase sm:text-6xl">
        {headline}
        <span className="animate-blink">…</span>
      </h2>
    </div>
  );
}

function DuelPitStage({ pit }: { pit: DuelInProgress }) {
  return (
    <div className="mt-6 text-center">
      <p className="font-display text-7xl leading-none text-jev tabular-nums sm:text-9xl">
        {pit.score} = {pit.score}
      </p>
      <h2 id="theatre-title" className="mt-3 font-display text-3xl leading-none uppercase sm:text-5xl">
        Jev doesn't do draws.
      </h2>
      <p className="mt-3 inline-block bg-hot px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-[#111110] uppercase">
        ⚔️ Entering the Duel Pit…
      </p>
      {pit.duel ? (
        <div className="mt-8">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3 sm:gap-6">
            <Contender key={`a-${pit.duel.n}`} siteKey={pit.duel.a} side="left" />
            <span className="grid size-14 -rotate-6 animate-pulse place-items-center self-center rounded-full border-[3px] border-[#fbf6e7] bg-hot font-display text-2xl text-white sm:size-20 sm:text-4xl">
              VS
            </span>
            <Contender key={`b-${pit.duel.n}`} siteKey={pit.duel.b} side="right" />
          </div>
          <p className="mt-5 font-mono text-xs font-bold tracking-widest uppercase">
            Duel {pit.duel.n} of ~{pit.duel.of} · binary insertion until it finds its place
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Contender({ siteKey, side }: { siteKey: string; side: "left" | "right" }) {
  return (
    <div
      className={`flex min-w-0 flex-col items-center justify-center gap-2 border-[3px] border-[#fbf6e7] bg-[#1b1a15] px-2 py-4 ${
        side === "left" ? "jev-from-left" : "jev-from-right"
      }`}
    >
      <Favicon host={siteKey.split("/")[0] ?? siteKey} size={44} />
      <span className="text-xs font-bold [overflow-wrap:anywhere] sm:text-base">{siteKey}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before and after the show
// ---------------------------------------------------------------------------

export function AwaitingPayment({ orderId, simulated }: { orderId: string; simulated: boolean }) {
  const returnTo = `/judging/${orderId}`;
  return (
    <section aria-labelledby="payment-title" className="slab p-5 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <JevFace size={84} className="size-16 shrink-0 animate-wiggle sm:size-21" />
        <div className="min-w-0">
          <h2 id="payment-title" className="font-display text-4xl leading-none uppercase sm:text-6xl">
            Waiting for your $5…
          </h2>
          <p className="mt-3 max-w-xl text-lg">
            Payment confirmation can take a few seconds. Keep this tab open — Jev starts reading the moment your $5
            lands.
          </p>
          <p role="status" className="mt-5 flex items-center gap-2 font-mono text-sm font-bold">
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-hot" />
            </span>
            Checking with the payment desk…
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {simulated ? (
              <Link
                to={`/dev/checkout/${encodeURIComponent(orderId)}?return=${encodeURIComponent(returnTo)}`}
                className="btn px-5 py-3"
              >
                Open the simulated checkout
              </Link>
            ) : null}
            <Link to="/" className="btn btn-ghost px-5 py-3">
              Back to the board
            </Link>
          </div>
          <p className="mt-5 text-sm text-ink-soft">
            Closed the checkout by accident?{" "}
            <Link to="/#add" className="font-bold underline">
              Start over
            </Link>
            . Nothing is charged until checkout completes.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Mistrial({ order }: { order: OrderView }) {
  const fetcher = useFetcher<{ retried: boolean }>();
  const busy = fetcher.state !== "idle";
  const canRetry = order.paidAt !== null;
  return (
    <section aria-labelledby="mistrial-title" className="slab p-5 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <JevFace size={84} className="size-16 shrink-0 -rotate-12 grayscale sm:size-21" />
        <div className="min-w-0">
          <span className="sticker bg-hot! text-sm">Mistrial</span>
          <h2 id="mistrial-title" className="mt-3 font-display text-4xl leading-none uppercase sm:text-6xl">
            Jev couldn't finish.
          </h2>
          <p className="mt-3 max-w-xl border-l-[6px] border-hot pl-4 text-lg font-medium">
            {order.error ?? "Something went wrong inside Jev."}
          </p>
          {canRetry ? (
            <fetcher.Form method="post" className="mt-6">
              <button type="submit" disabled={busy} className="btn px-6 py-3.5 text-lg">
                {busy ? "Summoning Jev…" : "Ask Jev again (free)"}
              </button>
              <p className="mt-2 text-sm text-ink-soft">You already paid. Retrying costs nothing.</p>
            </fetcher.Form>
          ) : null}
          {fetcher.data?.retried === false ? (
            <p role="alert" className="mt-4 border-l-4 border-hot pl-3 font-bold">
              Jev couldn't restart this one. Refresh the page — it may already be back in the queue.
            </p>
          ) : null}
          <p className="mt-6 text-sm text-ink-soft">
            Make sure <span className="font-mono font-bold [overflow-wrap:anywhere]">{order.url}</span> loads in a
            normal browser.{" "}
            <Link to="/" className="font-bold underline">
              Back to the board
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
