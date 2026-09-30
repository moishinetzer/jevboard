import { useEffect, useRef, useState } from "react";
import { faviconUrl, formatCount } from "~/lib/format";

const AVATAR_COLORS = ["#7ed7b5", "#9ec5ff", "#d6c8ff", "#ffc2b5", "#ffe08a", "#b8e6a0"];

const hash = (text: string): number => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/**
 * A business's round avatar: its favicon on a white disc, or its first letter
 * on a pastel one when there's no favicon. Size it with `className` (e.g. `size-11`).
 */
/** Smaller images are blurry at row size (and 16px is Google's "no favicon" globe): use the next source. */
const MIN_ICON_NATURAL_PX = 24;

/**
 * A business's app icon the way outbid.lol shows one: a rounded square, filled
 * edge to edge. Its own apple-touch-icon (or large icon) when the crawl found
 * one, then Google's favicon service at 128px, then its initial on a colour.
 * The tile is white in both themes: logos with transparent backgrounds are
 * drawn for light pages and vanish on a dark one.
 */
export function SiteIcon({ host, iconUrl, className }: { host: string; iconUrl: string | null; className?: string }) {
  const sources = iconUrl ? [iconUrl, faviconUrl(host, 128)] : [faviconUrl(host, 128)];
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];
  const ref = useRef<HTMLImageElement>(null);
  const tooSmall = (img: HTMLImageElement) => img.naturalWidth < MIN_ICON_NATURAL_PX;
  // An image that loaded (or failed) before hydration never fires onLoad/onError on the client.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && tooSmall(img)) setAttempt((n) => n + 1);
  }, [src]);

  const frame = `relative shrink-0 overflow-hidden rounded-[24%] ${className ?? ""}`;
  if (!src) {
    return (
      <span
        aria-hidden
        className={`grid place-items-center text-[15px] font-bold text-on-jev sm:text-lg ${frame}`}
        style={{ background: AVATAR_COLORS[hash(host) % AVATAR_COLORS.length] }}
      >
        {host.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`block bg-white after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--line)] ${frame}`}
    >
      <img
        ref={ref}
        key={src}
        src={src}
        alt=""
        width={64}
        height={64}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-full object-cover"
        onLoad={(event) => {
          if (tooSmall(event.currentTarget)) setAttempt((n) => n + 1);
        }}
        onError={() => setAttempt((n) => n + 1)}
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
