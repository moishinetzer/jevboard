import { useEffect, useRef, useState } from "react";
import { faviconUrl, formatCount } from "~/lib/format";

const AVATAR_COLORS = ["#7ed7b5", "#9ec5ff", "#d6c8ff", "#ffc2b5", "#ffe08a", "#b8e6a0"];

const hash = (text: string): number => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/**
 * A business's round avatar: its favicon on a white disc, or its first letter
 * on a pastel one when there's no favicon. Size it with `className` (e.g. `size-11`).
 */
export function SiteAvatar({ host, className }: { host: string; className?: string }) {
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
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-full text-[15px] font-bold text-on-jev sm:text-lg ${className ?? ""}`}
        style={{ background: AVATAR_COLORS[hash(host) % AVATAR_COLORS.length] }}
      >
        {host.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full border border-line bg-white ${className ?? ""}`}>
      <img
        ref={ref}
        src={faviconUrl(host, 64)}
        alt=""
        width={32}
        height={32}
        loading="lazy"
        className="size-[55%] object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/** A 0–100 sub-score as a thin bar. */
export function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] font-semibold text-soft sm:text-xs">
        <span>{label}</span>
        <span className="text-ink tabular-nums">{value}</span>
      </div>
      <div className="mt-[3px] h-[5px] rounded-full bg-track sm:mt-1 sm:h-1.5">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

const dayLabel = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Views per day as tiny bars, oldest first; today is the accent. Hovering a
 * bar names the day. Decorative: the caller prints the total next to it.
 */
export function ViewsSpark({
  days,
  className,
}: {
  days: ReadonlyArray<{ readonly day: string; readonly views: number }>;
  className?: string;
}) {
  const max = Math.max(1, ...days.map((day) => day.views));
  return (
    <div aria-hidden className={`flex h-[22px] w-[90px] items-end gap-px sm:h-7 sm:w-[120px] sm:gap-0.5 ${className ?? ""}`}>
      {days.map((day, index) => (
        <span
          key={day.day}
          title={`${dayLabel(day.day)}: ${formatCount(day.views)} ${day.views === 1 ? "view" : "views"}`}
          className={`block flex-1 rounded-[1px] sm:rounded-[2px] ${index === days.length - 1 ? "bg-accent" : "bg-ink/15"}`}
          style={{ height: `${Math.max(8, Math.round((day.views / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}
