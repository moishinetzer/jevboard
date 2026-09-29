import { useLive } from "~/components/live";
import { formatCount, formatDuration, formatMoney } from "~/lib/format";
import { MARKER } from "./shared";

/**
 * The hero's momentum row: "Jev is judging N sites right now · X watching ·
 * N verdicts · $X fed to Jev since launch Nh ago". Refreshed by the live poll.
 */
export function LiveCounters({ className }: { className?: string }) {
  const { counters, now } = useLive();
  const since = counters.launchedAt ? formatDuration(now - counters.launchedAt) : null;
  const judging = counters.judgingNow;

  return (
    <dl className={`grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 ${className ?? ""}`} aria-label="Live court statistics">
      <Counter
        label="On the stand"
        value={formatCount(judging)}
        note={judging === 0 ? "Jev is idle. Rude." : judging === 1 ? "site being judged now" : "sites being judged now"}
        live={judging > 0}
        hot={judging > 0}
      />
      <Counter label="Watching" value={formatCount(counters.online)} note="spectators, live" live />
      <Counter
        label="Verdicts"
        value={formatCount(counters.judgments)}
        note={`${formatCount(counters.entries)} defendant${counters.entries === 1 ? "" : "s"} · ${formatCount(counters.rerolls)} retrial${counters.rerolls === 1 ? "" : "s"}`}
      />
      <Counter
        label="Fed to Jev"
        value={formatMoney(counters.revenueCents)}
        note={since ? `since launch ${since} ago` : "and counting"}
        highlight
      />
    </dl>
  );
}

function Counter({
  label,
  value,
  note,
  live = false,
  hot = false,
  highlight = false,
}: {
  label: string;
  value: string;
  note: string;
  live?: boolean;
  hot?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`slab-sm flex min-w-0 flex-col px-3 py-2.5 ${hot ? "bg-hot! text-white" : ""}`}>
      <dt className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest opacity-80">
        {live ? (
          <span className="relative flex size-2" aria-hidden>
            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${hot ? "bg-white" : "bg-hot"}`} />
            <span className={`relative inline-flex size-2 rounded-full ${hot ? "bg-white" : "bg-hot"}`} />
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="mt-1 truncate font-display text-4xl leading-none tabular-nums sm:text-[2.6rem]">
        {highlight ? <span className={MARKER}>{value}</span> : value}
      </dd>
      <dd className={`mt-1 truncate text-xs ${hot ? "text-white/90" : "text-ink-soft"}`}>{note}</dd>
    </div>
  );
}
