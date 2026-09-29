import type { ReactNode } from "react";
import { Histogram } from "~/components/ui";
import { formatCount, tierFor } from "~/lib/format";
import { EmptyNote } from "../shared";

/** One receipt line: a big number with a deadpan caption. */
export function StatTile({ label, value, note, accent = false }: { label: string; value: ReactNode; note?: ReactNode; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 p-4 sm:p-5 ${accent ? "bg-jev text-[#111110]" : "bg-card"}`}>
      <dt className={`text-xs font-bold uppercase tracking-wide ${accent ? "" : "text-ink-soft"}`}>{label}</dt>
      <dd className="order-first font-display text-4xl leading-none sm:text-5xl">{value}</dd>
      {note ? <dd className={`text-xs ${accent ? "" : "text-ink-soft"}`}>{note}</dd> : null}
    </div>
  );
}

/** Tiles in a ruled grid, like a till receipt. */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="slab grid grid-cols-2 gap-0.5 bg-line/25! lg:grid-cols-4">
      {children}
    </dl>
  );
}

/** Score distribution plus the average / high / low. */
export function ScoreSummary({
  histogram,
  average,
  highest,
  lowest,
}: {
  histogram: ReadonlyArray<number>;
  average: number | null;
  highest: number | null;
  lowest: number | null;
}) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return <EmptyNote>No scores yet. The first verdict sets the curve.</EmptyNote>;
  const rows = [
    { label: "Lowest", value: lowest },
    { label: "Average", value: average },
    { label: "Highest", value: highest },
  ] as const;
  return (
    <div>
      <Histogram buckets={histogram} highlight={average ?? undefined} />
      <p className="mt-2 text-xs text-ink-soft">
        {formatCount(total)} scored defendants in buckets of 100. <span className="font-bold text-hot">Red</span> marks the bucket
        where the average defendant lives.
      </p>
      <dl className="mt-5 grid grid-cols-3 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="border-2 border-line p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-soft">{row.label}</dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="score-num text-3xl sm:text-4xl">{row.value ?? "—"}</span>
              <span className="font-mono text-[10px] font-bold text-ink-soft">/1000</span>
            </dd>
            {row.value !== null ? <dd className="mt-1 truncate text-[11px] font-bold">{tierFor(row.value).label}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Entries per category as horizontal bars (one series, so one colour). */
export function CategoryBars({ categories }: { categories: ReadonlyArray<{ readonly category: string; readonly count: number }> }) {
  if (categories.length === 0) return <EmptyNote>No categories yet. Jev files every defendant under one.</EmptyNote>;
  const total = categories.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(...categories.map((row) => row.count));
  return (
    <ul className="flex flex-col gap-3">
      {categories.map((row) => {
        const share = Math.round((row.count / total) * 100);
        return (
          <li key={row.category}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-bold">{row.category}</span>
              <span className="tabular shrink-0 text-xs text-ink-soft">
                <span className="font-bold text-ink">{formatCount(row.count)}</span> · {share}%
              </span>
            </div>
            <div className="mt-1 h-3 bg-ink/10" aria-hidden>
              <div className="h-full bg-ink" style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
