import { useState } from "react";
import { formatCount } from "~/lib/format";

interface ViewDay {
  readonly day: string;
  readonly views: number;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const dayLabel = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Stat tile: total views over the period plus one bar per day. Past days are
 * muted ink, today is the accent. Hovering or focusing a day shows its count;
 * a hidden table carries every value for screen readers.
 */
export function ViewsTile({ label, days, className }: { label: string; days: ReadonlyArray<ViewDay>; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = days.reduce((sum, day) => sum + day.views, 0);
  const max = Math.max(1, ...days.map((day) => day.views));
  const width = 240;
  const height = 44;
  const slot = width / Math.max(1, days.length);
  const gap = 2;
  const shown = active === null ? null : days[active];

  return (
    <figure className={`min-w-0 ${className ?? ""}`}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="tabular text-xs text-ink-soft" aria-live="polite">
          {shown ? `${dayLabel(shown.day)}: ${formatCount(shown.views)}` : ""}
        </span>
      </figcaption>
      <p className="tabular text-3xl font-bold leading-tight" title={formatCount(total)}>
        {compact.format(total)}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-1 block h-11 w-full"
        role="img"
        aria-label={`${label}: ${formatCount(total)} in total`}
        onPointerLeave={() => setActive(null)}
      >
        <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="var(--line)" strokeOpacity="0.25" />
        {days.map((day, index) => {
          const barHeight = day.views === 0 ? 0 : Math.max(2, (day.views / max) * (height - 2));
          const today = index === days.length - 1;
          return (
            <g key={day.day}>
              {barHeight > 0 ? (
                <rect
                  x={index * slot + gap / 2}
                  y={height - barHeight}
                  width={Math.max(1, slot - gap)}
                  height={barHeight}
                  fill={today ? "var(--hot)" : "var(--ink)"}
                  fillOpacity={today || active === index ? 1 : 0.35}
                />
              ) : null}
              {/* Hit area: the whole column, taller and wider than the bar. */}
              <rect
                x={index * slot}
                y={0}
                width={slot}
                height={height}
                fill="transparent"
                tabIndex={-1}
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
              />
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}, by day</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{dayLabel(day.day)}</th>
              <td>{day.views}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
