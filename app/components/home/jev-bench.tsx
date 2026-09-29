import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useLive, useNow } from "~/components/live";
import { JevFace } from "~/components/logo";
import { Favicon } from "~/components/ui";
import { entryPath } from "~/lib/site-key";
import { focusRing, formatReign, ON_JEV } from "./shared";

const JEV_SAYS = [
  "Jev has concerns about your hero gradient.",
  "Counting the word “seamless”: 6.",
  "Jev doesn't do draws.",
  "Found a “Book a demo” button. Jev is disappointed.",
  "Jev read your landing page so your customers don't have to.",
  "1,000 points of usefulness. Handed out grudgingly.",
  "Your score can go down. That's the point.",
];

/**
 * The hero's right-hand card: Jev himself, muttering, plus the reigning #1
 * with a live reign clock.
 */
export function JevBench({ king }: { king: { siteKey: string; name: string; host: string } | null }) {
  const { counters, now: serverNow } = useLive();
  const now = useNow(1000, serverNow);
  const reign = counters.king;
  // The podium comes from this page's loader; the live counters may already know a newer king.
  const name = reign && king?.siteKey === reign.siteKey ? king.name : reign?.siteKey;
  const host = reign && king?.siteKey === reign.siteKey ? king.host : reign?.siteKey.split("/")[0];

  return (
    <aside className="slab relative isolate overflow-hidden p-5 sm:p-6" style={ON_JEV} aria-label="Jev's bench">
      <div className="halftone absolute inset-0 -z-10" aria-hidden />
      <span className="sticker absolute top-3 right-3 rotate-6 bg-hot! text-white! shadow-[2px_2px_0_#111110]">
        No refunds. No mercy.
      </span>

      <div className="flex items-end gap-3 pt-6">
        <JevFace size={112} className="shrink-0 drop-shadow-[4px_4px_0_#111110]" />
        <JevQuote />
      </div>

      <div className="mt-6 border-t-[3px] border-dashed border-[#111110] pt-4">
        <p className="font-mono text-xs font-bold uppercase tracking-widest">👑 Now reigning</p>
        {reign ? (
          <Link
            to={entryPath(reign.siteKey)}
            className={`group mt-2 flex items-center gap-3 border-[3px] border-[#111110] bg-card p-3 shadow-[4px_4px_0_#111110] transition-transform hover:-translate-y-0.5 ${focusRing}`}
          >
            <Favicon host={host ?? reign.siteKey} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold leading-tight group-hover:underline">{name}</span>
              <span className="block truncate font-mono text-xs text-ink-soft">{reign.siteKey}</span>
            </span>
            <span className="score-num shrink-0 text-5xl">{reign.score}</span>
          </Link>
        ) : (
          <p className="mt-2 font-display text-2xl uppercase">The throne is empty. Be the first defendant.</p>
        )}
        {reign ? (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            <span>On the throne for</span>
            <time
              className="tabular bg-[#111110] px-2 py-0.5 text-base text-jev"
              dateTime={new Date(reign.since).toISOString()}
              suppressHydrationWarning
            >
              {formatReign(now - reign.since)}
            </time>
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/** A speech bubble that cycles through Jev's courtroom mutterings. */
function JevQuote() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((current) => (current + 1) % JEV_SAYS.length), 4200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="relative mb-4 min-w-0 flex-1">
      <p
        key={index}
        className="relative animate-pop border-[3px] border-[#111110] bg-card px-3 py-2 font-mono text-sm font-bold leading-snug shadow-[3px_3px_0_#111110]"
      >
        {JEV_SAYS[index]}
      </p>
      <span
        className="absolute -bottom-[9px] left-4 size-4 rotate-45 border-r-[3px] border-b-[3px] border-[#111110] bg-card"
        aria-hidden
      />
    </div>
  );
}
