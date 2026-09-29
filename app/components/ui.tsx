import { useState } from "react";
import { faviconUrl, formatDelta, tierFor } from "~/lib/format";

/** Site favicon with a lettered fallback. */
export function Favicon({ host, size = 32, className }: { host: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={`grid shrink-0 place-items-center border-2 border-line bg-jev font-display text-[#111110] ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden
      >
        {host.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={faviconUrl(host, 64)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 border-2 border-line bg-white object-contain p-0.5 ${className ?? ""}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

/** Big tabular score with the tier colour. `size` is a Tailwind text size class. */
export function Score({ score, size = "text-4xl", suffix = true }: { score: number; size?: string; suffix?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`score-num ${size}`}>{score}</span>
      {suffix ? <span className="font-mono text-xs font-bold text-ink-soft">/1000</span> : null}
    </span>
  );
}

/** Coloured tier label: "🔥 Genuinely Useful". */
export function TierBadge({ score, className }: { score: number; className?: string }) {
  const tier = tierFor(score);
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 border-[#111110] px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${className ?? ""}`}
      style={{ background: tier.color, color: tier.ink }}
    >
      <span aria-hidden>{tier.emoji}</span>
      {tier.label}
    </span>
  );
}

/** +42 / -17 / ±0 score movement. */
export function Delta({ delta, className }: { delta: number; className?: string }) {
  const color = delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-ink-soft";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "■";
  return (
    <span className={`tabular inline-flex items-center gap-0.5 text-xs font-bold ${color} ${className ?? ""}`}>
      <span aria-hidden>{arrow}</span>
      {formatDelta(delta)}
    </span>
  );
}

/** The Pudding-style hyphenated verdict label, rendered as a sticker. */
export function VerdictLabel({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`inline-block rotate-[-1deg] border-2 border-[#111110] bg-jev px-2 py-0.5 font-mono text-xs font-bold text-[#111110] ${className ?? ""}`}>
      “{label}”
    </span>
  );
}

/** Tiny line chart of score history (oldest → newest). */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  className,
}: {
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return null;
  const min = Math.min(...values, 1);
  const max = Math.max(...values, 1000);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (value: number) => height - 3 - ((value - min) / Math.max(1, max - min)) * (height - 6);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values[values.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`Score history: ${values.join(", ")}`}>
      {values.length > 1 ? (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
      <circle cx={(values.length - 1) * step} cy={y(last)} r="4" fill="var(--hot)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Ten-bucket score distribution with an optional "you are here" marker. */
export function Histogram({
  buckets,
  highlight,
  className,
}: {
  buckets: ReadonlyArray<number>;
  /** A score to mark. */
  highlight?: number;
  className?: string;
}) {
  const max = Math.max(1, ...buckets);
  const highlighted = highlight === undefined ? -1 : Math.min(9, Math.floor((highlight - 1) / 100));
  return (
    <div className={`flex h-40 items-end gap-1.5 ${className ?? ""}`} role="img" aria-label="Score distribution">
      {buckets.map((count, index) => (
        <div key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="tabular text-[10px] font-bold">{count}</span>
          <div
            className={`w-full border-2 border-line ${index === highlighted ? "bg-hot" : "bg-jev"}`}
            style={{ height: `${Math.max(3, (count / max) * 100)}%` }}
            title={`${index * 100 + 1}–${(index + 1) * 100}: ${count}`}
          />
          <span className="tabular text-[10px] text-ink-soft">{index * 100 + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** 0–100 bar for sub-scores. */
export function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-bold uppercase tracking-wide">
        <span>{label}</span>
        <span className="tabular">{value}</span>
      </div>
      <div className="mt-1 h-3 border-2 border-line bg-paper">
        <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
