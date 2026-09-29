import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { BoardEntry } from "~/.server/domain/models";
import { useLive, useNow } from "~/components/live";
import { JevFace } from "~/components/logo";
import { Favicon } from "~/components/ui";
import { formatCount, formatMoney, tierFor, timeAgo } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { focusRing, formatClock } from "../shared";

export type TvEntry = Pick<BoardEntry, "siteKey" | "score" | "rank" | "label" | "rolls" | "lastDelta">;

export const toTvEntry = (entry: BoardEntry): TvEntry => ({
  siteKey: entry.siteKey,
  score: entry.score,
  rank: entry.rank,
  label: entry.label,
  rolls: entry.rolls,
  lastDelta: entry.lastDelta,
});

/** Re-runs the route loader every `intervalMs` while the tab is visible. */
export const useAutoRevalidate = (intervalMs: number): number => {
  const revalidator = useRevalidator();
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());
  const state = useRef(revalidator.state);
  state.current = revalidator.state;

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && state.current === "idle") void revalidator.revalidate();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, revalidator]);

  useEffect(() => {
    if (revalidator.state === "idle") setLastUpdated(Date.now());
  }, [revalidator.state]);

  return lastUpdated;
};

/** Rank moves since the previous load: siteKey → places gained (0 = new in the top 10). */
const useRankMoves = (entries: ReadonlyArray<TvEntry>): ReadonlyMap<string, number> => {
  const previous = useRef<ReadonlyMap<string, number> | null>(null);
  const [moves, setMoves] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const before = previous.current;
    if (before) {
      const next = new Map<string, number>();
      for (const entry of entries) {
        const was = before.get(entry.siteKey);
        if (was === undefined) next.set(entry.siteKey, 0);
        else if (was !== entry.rank) next.set(entry.siteKey, was - entry.rank);
      }
      setMoves(next);
    }
    previous.current = new Map(entries.map((entry) => [entry.siteKey, entry.rank]));
  }, [entries]);
  return moves;
};

/** Fullscreen toggle for the TV block (hides the site chrome on a big screen). */
export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setSupported(document.fullscreenEnabled);
    const onChange = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => (active ? void document.exitFullscreen() : void target.current?.requestFullscreen())}
      className={`btn px-3 py-1.5 text-xs ${focusRing}`}
    >
      {active ? "Exit fullscreen" : "⛶ Fullscreen"}
    </button>
  );
}

export function TvClock({ serverNow }: { serverNow: number }) {
  const now = useNow(1000, serverNow);
  const time = new Date(now).toISOString().slice(11, 19);
  return (
    <span className="tabular text-sm font-bold" suppressHydrationWarning>
      {time} UTC
    </span>
  );
}

export function UpdatedAgo({ at }: { at: number }) {
  const now = useNow(1000, at);
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="font-mono text-xs text-ink-soft" suppressHydrationWarning>
      Updated {seconds < 2 ? "just now" : `${seconds}s ago`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The big board
// ---------------------------------------------------------------------------

export function TvBoard({ entries }: { entries: ReadonlyArray<TvEntry> }) {
  const moves = useRankMoves(entries);
  if (entries.length === 0) {
    return (
      <div className="grid min-h-96 place-items-center border-[3px] border-dashed border-line p-10 text-center">
        <p className="font-display text-5xl uppercase">The docket is empty. Be the first defendant.</p>
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Top 10">
      {entries.map((entry) => {
        const tier = tierFor(entry.score);
        const move = moves.get(entry.siteKey);
        return (
          <li
            key={entry.siteKey}
            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-[3px] border-line bg-card px-3 py-[clamp(0.25rem,0.6vh,0.6rem)] sm:gap-5 sm:px-4 ${
              move !== undefined ? "animate-pop outline-4 outline-jev" : ""
            } ${entry.rank === 1 ? "shadow-[6px_6px_0_var(--jev)]" : ""}`}
          >
            <span
              className="grid w-[clamp(2.75rem,min(5vw,8vh),5rem)] place-items-center border-[3px] border-[#111110] py-1 font-display text-[clamp(1.75rem,min(3.4vw,4.6vh),3.5rem)] leading-none"
              style={{ background: tier.color, color: tier.ink }}
            >
              {entry.rank}
            </span>
            <Link to={entryPath(entry.siteKey)} className={`flex min-w-0 flex-col gap-0.5 ${focusRing}`}>
              <span className="flex min-w-0 items-center gap-3">
                <Favicon host={entry.siteKey.split("/")[0]!} size={32} className="hidden sm:grid" />
                <span className="truncate text-[clamp(1.1rem,min(2vw,2.9vh),2.4rem)] font-bold leading-tight">{entry.siteKey}</span>
                {move !== undefined ? (
                  <span className="sticker shrink-0">{move === 0 ? "New" : move > 0 ? `▲ ${move}` : `▼ ${-move}`}</span>
                ) : null}
              </span>
              <span className="truncate font-mono text-[clamp(0.7rem,min(0.9vw,1.4vh),0.95rem)] leading-tight text-ink-soft">“{entry.label}”</span>
            </Link>
            <span className="flex items-baseline gap-1">
              <span className="score-num text-[clamp(2.25rem,min(4.2vw,5.6vh),5rem)]">{entry.score}</span>
              <span className="hidden font-mono text-[10px] font-bold text-ink-soft sm:inline">/1000</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

export function KingPanel({ serverNow }: { serverNow: number }) {
  const { counters } = useLive();
  const now = useNow(1000, serverNow);
  const king = counters.king;
  return (
    <section aria-label="Current #1" className="relative border-[3px] border-[#111110] bg-jev p-5 text-[#111110] shadow-[8px_8px_0_var(--hot)]">
      <span className="absolute -top-7 right-5 animate-wiggle text-5xl" aria-hidden>
        👑
      </span>
      <p className="font-mono text-xs font-bold uppercase tracking-widest">Reign of #1</p>
      {king ? (
        <>
          <p className="mt-2 break-words font-display text-[clamp(2rem,min(3.4vw,5vh),3.75rem)] uppercase leading-none">{king.siteKey}</p>
          <p className="mt-2 font-bold">{king.score}/1000</p>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide">Reigning for</p>
          <p className="tabular text-[clamp(1.75rem,min(2.8vw,4.2vh),3rem)] font-bold leading-tight" suppressHydrationWarning>
            {formatClock(now - king.since)}
          </p>
        </>
      ) : (
        <p className="mt-2 font-display text-4xl uppercase">The throne is empty</p>
      )}
    </section>
  );
}

function Counter({ label, value, live = false }: { label: string; value: ReactNode; live?: boolean }) {
  return (
    <div className="border-[3px] border-line bg-card px-3 py-2.5 sm:px-4">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
        {live ? <span className="size-2 animate-blink rounded-full bg-hot" aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1 font-display text-[clamp(2rem,min(3.2vw,4.6vh),3.5rem)] leading-none">{value}</p>
    </div>
  );
}

export function TvCounters() {
  const { counters } = useLive();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Counter label="Watching" value={formatCount(counters.online)} live />
      <Counter label="Being judged" value={formatCount(counters.judgingNow)} live={counters.judgingNow > 0} />
      <Counter label="Judgments" value={formatCount(counters.judgments)} />
      <Counter label="Fed to Jev" value={formatMoney(counters.revenueCents)} />
    </div>
  );
}

/** The latest events, big. */
export function TvFeed({ serverNow, limit = 3 }: { serverNow: number; limit?: number }) {
  const { tape, fresh } = useLive();
  const now = useNow(5000, serverNow);
  const events = tape.slice(0, limit);
  return (
    <section aria-label="Latest on the tape" className="border-[3px] border-line bg-card">
      <h2 className="flex items-center gap-2 border-b-[3px] border-line bg-hot px-3 py-1.5 font-display text-xl uppercase text-white">
        <span className="size-2 animate-blink rounded-full bg-white" aria-hidden />
        The Tape
      </h2>
      {events.length === 0 ? (
        <p className="p-4 text-ink-soft">The docket is empty. Be the first defendant.</p>
      ) : (
        <ol className="divide-y-2 divide-line/20" aria-live="polite">
          {events.map((event) => (
            <li key={event.id} className={`px-3 py-2.5 ${fresh.has(event.id) ? "animate-pop bg-jev/15" : ""}`}>
              <p className="text-[clamp(0.9rem,1.1vw,1.15rem)] font-medium leading-snug">{event.message}</p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-soft" suppressHydrationWarning>
                {timeAgo(event.createdAt, now)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A big marquee of the tape along the bottom of the screen. */
export function TvMarquee() {
  const { tape } = useLive();
  const items = tape.length > 0 ? tape.slice(0, 20).map((event) => event.message) : ["The docket is empty. Be the first defendant."];
  const run = (hidden: boolean) =>
    items.map((message, index) => (
      <span key={`${hidden ? "b" : "a"}-${index}`} className="flex shrink-0 items-center gap-6 px-6" aria-hidden={hidden || undefined}>
        {message}
        <span className="text-[#111110]/50">✦</span>
      </span>
    ));
  return (
    <div className="flex overflow-hidden border-y-[3px] border-[#111110] bg-jev py-2 font-display text-[clamp(1.5rem,min(2.6vw,4vh),2.75rem)] uppercase text-[#111110]">
      <div className="flex w-max animate-marquee" aria-hidden>
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}

export function TvCallToAction({ host }: { host: string }) {
  return (
    <div className="flex items-center gap-4 border-[3px] border-line bg-card px-4 py-3">
      <JevFace size={56} className="shrink-0 animate-wiggle" />
      <div className="min-w-0">
        <p className="font-display text-[clamp(1.4rem,2vw,2.25rem)] uppercase leading-none">Get judged at</p>
        <p className="truncate font-display text-[clamp(1.4rem,2vw,2.25rem)] uppercase leading-tight text-jev">{host}</p>
        <p className="text-sm text-ink-soft">$5. You can't buy #1. You can only buy Jev's attention.</p>
      </div>
    </div>
  );
}
