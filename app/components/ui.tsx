import { useEffect, useRef, useState } from "react";
import { faviconUrl, formatDelta, tierFor } from "~/lib/format";

/** Site favicon with a lettered fallback. */
export function Favicon({ host, size = 32, className }: { host: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError on the client.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
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
      ref={ref}
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
