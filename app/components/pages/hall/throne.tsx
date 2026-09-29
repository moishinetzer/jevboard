import { Link } from "react-router";
import type { Reign } from "~/.server/domain/models";
import { useNow } from "~/components/live";
import { Favicon, TierBadge } from "~/components/ui";
import { formatCount } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import {
  EmptyNote,
  focusRing,
  formatClock,
  formatDateTime,
  formatReignLength,
  ON_JEV,
  SiteLink,
} from "../shared";
import type { CurrentKing, ThroneReign } from "./throne-history";

const TIMELINE_LIMIT = 40;

/** Exhibit A: the current king with a live reign clock, every reign before it, and the records. */
export function ThroneRoom({
  king,
  reigns,
  longest,
  serverNow,
}: {
  king: (CurrentKing & { readonly name: string }) | null;
  reigns: ReadonlyArray<ThroneReign>;
  longest: ReadonlyArray<Reign>;
  serverNow: number;
}) {
  const now = useNow(1000, serverNow);
  const lengthOf = (reign: { startedAt: number; endedAt: number | null }) => (reign.endedAt ?? now) - reign.startedAt;
  const shown = reigns.slice(0, TIMELINE_LIMIT);
  const longestShown = Math.max(1, ...shown.map(lengthOf));
  const kings = new Set(reigns.map((reign) => reign.siteKey)).size;

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-5">
        <KingCard king={king} now={now} />
        <LongestReigns longest={longest} kingSiteKey={king?.siteKey ?? null} now={now} serverNow={serverNow} />
      </div>

      <div className="lg:col-span-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl uppercase">The Reign of #1</h3>
          <p className="font-mono text-xs font-bold uppercase text-ink-soft">
            {formatCount(reigns.length)} reign{reigns.length === 1 ? "" : "s"} · {formatCount(kings)} king{kings === 1 ? "" : "s"}
          </p>
        </div>
        {shown.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>No coronations on record yet. The first defendant gets the crown by default.</EmptyNote>
          </div>
        ) : (
          <ol className="slab mt-4 divide-y-2 divide-line/15">
            {shown.map((reign, index) => (
              <ReignRow
                key={`${reign.siteKey}-${reign.startedAt}`}
                reign={reign}
                number={reigns.length - index}
                length={lengthOf(reign)}
                share={lengthOf(reign) / longestShown}
              />
            ))}
          </ol>
        )}
        {reigns.length > shown.length ? (
          <p className="mt-3 font-mono text-xs text-ink-soft">
            Showing the latest {TIMELINE_LIMIT} reigns of {formatCount(reigns.length)}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function KingCard({ king, now }: { king: (CurrentKing & { readonly name: string }) | null; now: number }) {
  if (!king) {
    return (
      <div className="slab p-6 text-center">
        <p className="font-display text-3xl uppercase">The throne is empty</p>
        <p className="mt-2 text-ink-soft">No defendant, no king. Be the first and you're #1 by default (for now).</p>
        <Link to="/#judge" className={`btn mt-5 px-5 py-3 ${focusRing}`}>
          Get judged — $5
        </Link>
      </div>
    );
  }
  return (
    <div className="relative border-[3px] border-[#111110] p-6 shadow-[8px_8px_0_var(--hot)]" style={ON_JEV}>
      <span className="absolute -top-8 right-6 animate-wiggle text-5xl drop-shadow-[3px_3px_0_#111110]" aria-hidden>
        👑
      </span>
      <p className="font-mono text-xs font-bold uppercase tracking-widest">Current king of Jevboard</p>
      <Link
        to={entryPath(king.siteKey)}
        className={`mt-3 flex min-w-0 items-center gap-3 hover:underline ${focusRing}`}
      >
        <Favicon host={king.siteKey.split("/")[0]!} size={44} />
        <span className="min-w-0 break-words font-display text-4xl uppercase leading-none sm:text-5xl">{king.siteKey}</span>
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-baseline gap-1">
          <span className="score-num text-5xl">{king.score}</span>
          <span className="font-mono text-xs font-bold">/1000</span>
        </span>
        <TierBadge score={king.score} />
      </div>
      <div className="mt-5 border-t-[3px] border-[#111110] pt-4">
        <p className="text-xs font-bold uppercase tracking-wide">Reigning for</p>
        <p className="tabular mt-1 text-3xl font-bold sm:text-4xl" aria-live="off" suppressHydrationWarning>
          {formatClock(now - king.since)}
        </p>
        <p className="mt-1 font-mono text-xs">Crowned {formatDateTime(king.since)}</p>
      </div>
      <p className="mt-5 text-sm font-bold">Think you're more useful? Jev doesn't do favours, but Jev does do verdicts.</p>
      <Link to="/#judge" className={`btn btn-hot mt-3 px-5 py-3 ${focusRing}`}>
        Challenge the throne — $5
      </Link>
    </div>
  );
}

function ReignRow({ reign, number, length, share }: { reign: ThroneReign; number: number; length: number; share: number }) {
  const current = reign.endedAt === null;
  return (
    <li className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-3 sm:px-4 ${current ? "bg-jev/25" : ""}`}>
      <span className="tabular row-span-2 self-start pt-0.5 text-xs font-bold text-ink-soft">№{number}</span>
      <SiteLink siteKey={reign.siteKey} size={20} className="max-w-full text-sm" />
      <span className="tabular text-right text-sm font-bold" suppressHydrationWarning>
        {current ? "👑 " : ""}
        {formatReignLength(length)}
      </span>
      <div className="col-span-2 flex flex-col gap-1.5">
        <div className="h-1.5 bg-ink/10" aria-hidden>
          <div className={`h-full ${current ? "bg-hot" : "bg-ink"}`} style={{ width: `${Math.max(1.5, share * 100)}%` }} />
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
          <span>
            Crowned {formatDateTime(reign.startedAt)}
            {reign.score !== null ? ` at ${reign.score}` : ""}
          </span>
          {current ? (
            <span className="font-bold text-ink">Still on the throne</span>
          ) : reign.dethronedBy ? (
            <span>
              💀 {reign.selfInflicted ? "Rerolled itself off the throne; crown went to " : "Dethroned by "}
              <Link to={entryPath(reign.dethronedBy)} className={`font-bold text-ink underline ${focusRing}`}>
                {reign.dethronedBy}
              </Link>
            </span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function LongestReigns({
  longest,
  kingSiteKey,
  now,
  serverNow,
}: {
  longest: ReadonlyArray<Reign>;
  kingSiteKey: string | null;
  now: number;
  serverNow: number;
}) {
  if (longest.length === 0) return null;
  // The loader measured open reigns up to serverNow; keep them ticking.
  const length = (reign: Reign) => (reign.endedAt === null ? reign.durationMs + (now - serverNow) : reign.durationMs);
  return (
    <div className="slab p-5">
      <h3 className="font-display text-2xl uppercase">Longest reigns</h3>
      <p className="text-sm text-ink-soft">The all-time record book. Beat it by being useful for longer.</p>
      <ol className="mt-4 flex flex-col divide-y-2 divide-line/15">
        {longest.slice(0, 5).map((reign, index) => (
          <li key={`${reign.entryId}-${reign.startedAt}`} className="flex items-center gap-3 py-2">
            <span className="w-6 shrink-0 font-display text-2xl leading-none">{index + 1}</span>
            <SiteLink siteKey={reign.siteKey} size={20} className="min-w-0 flex-1 text-sm" />
            <span className="tabular shrink-0 text-right text-xs font-bold" suppressHydrationWarning>
              {formatReignLength(length(reign))}
              {reign.endedAt === null && reign.siteKey === kingSiteKey ? (
                <span className="ml-1 text-hot" title="Still reigning">
                  ●
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
