import { useId, useState, type KeyboardEvent } from "react";
import { formatCount, formatMoney } from "~/lib/format";

export interface DailyPoint {
  /** YYYY-MM-DD (UTC) */
  readonly day: string;
  readonly judgments: number;
  readonly rerolls: number;
  readonly revenueCents: number;
}

// Validated pair (dataviz validator, light + dark surfaces): blue + hot.
const FIRST_COLOR = "#2563eb";
const RETRIAL_COLOR = "#ff3b1f";

const W = 720;
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 14;
const AXIS_H = 24;
const BARS_PLOT_H = 170;
const LINE_PLOT_H = 120;
const PLOT_W = W - PAD_L - PAD_R;

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const parseDay = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Rounds up to 1/2/2.5/5 × 10^n so ticks land on clean numbers. */
const niceMax = (value: number): number => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
};

/**
 * Last-30-days small multiples sharing one x axis and one hover state:
 * judgments per day (first judgments + retrials, stacked) and revenue to date
 * (cumulative, all-time). Two charts instead of one dual-axis chart.
 * Arrow keys move the inspected day; a table view carries every value.
 */
export function DailyCharts({ days, revenueBeforeCents }: { days: ReadonlyArray<DailyPoint>; revenueBeforeCents: number }) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const n = days.length;
  if (n === 0) return null;

  const slot = PLOT_W / n;
  const barW = Math.min(18, slot * 0.7);
  const cx = (index: number) => PAD_L + slot * index + slot / 2;

  const judgmentsMax = niceMax(Math.max(...days.map((d) => d.judgments)));
  const running = days.reduce<Array<number>>((acc, d) => [...acc, (acc[acc.length - 1] ?? revenueBeforeCents) + d.revenueCents], []);
  const revenueMax = niceMax(Math.max(...running) / 100) * 100;

  const barY = (value: number) => PAD_T + BARS_PLOT_H - (value / judgmentsMax) * BARS_PLOT_H;
  const lineY = (cents: number) => PAD_T + LINE_PLOT_H - (cents / revenueMax) * LINE_PLOT_H;

  const linePoints = running.map((cents, index) => `${cx(index).toFixed(1)},${lineY(cents).toFixed(1)}`);
  const areaPath = `M${cx(0)},${lineY(0)} L${linePoints.join(" L")} L${cx(n - 1)},${lineY(0)} Z`;
  const last = running[n - 1] ?? 0;

  const tickDays = days.map((_, index) => index).filter((index) => (n - 1 - index) % 7 === 0);
  const totals = days.reduce(
    (acc, d) => ({ judgments: acc.judgments + d.judgments, rerolls: acc.rerolls + d.rerolls, revenue: acc.revenue + d.revenueCents }),
    { judgments: 0, rerolls: 0, revenue: 0 },
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setActive((current) => {
      const from = current ?? n - 1;
      if (event.key === "Home") return 0;
      if (event.key === "End") return n - 1;
      return Math.max(0, Math.min(n - 1, from + (event.key === "ArrowLeft" ? -1 : 1)));
    });
  };

  const crosshair = (plotH: number) =>
    active === null ? null : (
      <line x1={cx(active)} x2={cx(active)} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1} />
    );

  const hitTargets = (plotH: number) =>
    days.map((d, index) => (
      <rect
        key={d.day}
        x={PAD_L + slot * index}
        y={PAD_T}
        width={slot}
        height={plotH}
        fill="transparent"
        onMouseEnter={() => setActive(index)}
      />
    ));

  const xAxis = (plotH: number) => (
    <g>
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--ink)" strokeOpacity={0.3} strokeWidth={1} />
      {tickDays.map((index) => (
        <text
          key={index}
          x={cx(index)}
          y={PAD_T + plotH + 17}
          textAnchor={index === n - 1 ? "end" : "middle"}
          className="fill-ink-soft font-mono text-[11px]"
        >
          {index === n - 1 ? "Today" : DAY_LABEL.format(parseDay(days[index]!.day))}
        </text>
      ))}
    </g>
  );

  const yGrid = (max: number, plotH: number, format: (value: number) => string) =>
    [0, max / 2, max].map((value) => {
      const y = PAD_T + plotH - (value / max) * plotH;
      return (
        <g key={value}>
          {value > 0 ? <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="var(--ink)" strokeOpacity={0.12} strokeWidth={1} /> : null}
          <text x={PAD_L - 8} y={y + 4} textAnchor="end" className="fill-ink-soft font-mono text-[11px]">
            {format(value)}
          </text>
        </g>
      );
    });

  const activeDay = active === null ? null : days[active]!;
  const tooltipLeft = active === null ? 0 : (cx(active) / W) * 100;

  return (
    <div>
      <div
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? n - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="relative outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-hot"
      >
        <p id={titleId} className="sr-only">
          Judgments and revenue per day for the last {n} days. Use the left and right arrow keys to read each day.
        </p>

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-display text-2xl uppercase">Judgments per day</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
            <li className="flex items-center gap-1.5">
              <span className="size-3" style={{ background: FIRST_COLOR }} aria-hidden />
              First judgments
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3" style={{ background: RETRIAL_COLOR }} aria-hidden />
              Retrials
            </li>
          </ul>
        </div>
        <svg viewBox={`0 0 ${W} ${PAD_T + BARS_PLOT_H + AXIS_H}`} className="mt-2 block h-auto w-full" aria-hidden>
          {yGrid(judgmentsMax, BARS_PLOT_H, (value) => formatCount(value))}
          {crosshair(BARS_PLOT_H)}
          {days.map((d, index) => {
            const first = d.judgments - d.rerolls;
            const firstTop = barY(first);
            const retrialH = (d.rerolls / judgmentsMax) * BARS_PLOT_H;
            const dim = active !== null && active !== index ? 0.45 : 1;
            return (
              <g key={d.day} opacity={dim}>
                {first > 0 ? (
                  <rect x={cx(index) - barW / 2} y={firstTop} width={barW} height={PAD_T + BARS_PLOT_H - firstTop} fill={FIRST_COLOR} />
                ) : null}
                {d.rerolls > 0 ? (
                  <rect
                    x={cx(index) - barW / 2}
                    y={firstTop - retrialH - (first > 0 ? 2 : 0)}
                    width={barW}
                    height={retrialH}
                    fill={RETRIAL_COLOR}
                  />
                ) : null}
              </g>
            );
          })}
          {xAxis(BARS_PLOT_H)}
          {hitTargets(BARS_PLOT_H)}
        </svg>

        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-display text-2xl uppercase">Fed to Jev, all-time</h3>
          <p className="text-xs font-bold text-ink-soft">Running total of paid judgments, in USD</p>
        </div>
        <svg viewBox={`0 0 ${W} ${PAD_T + LINE_PLOT_H + AXIS_H}`} className="mt-2 block h-auto w-full" aria-hidden>
          {yGrid(revenueMax, LINE_PLOT_H, (value) => formatMoney(value))}
          {crosshair(LINE_PLOT_H)}
          <path d={areaPath} fill="var(--jev)" fillOpacity={0.35} />
          <polyline points={linePoints.join(" ")} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle
            cx={cx(active ?? n - 1)}
            cy={lineY(running[active ?? n - 1] ?? 0)}
            r={5}
            fill={RETRIAL_COLOR}
            stroke="var(--card)"
            strokeWidth={2}
          />
          {active === null ? (
            <text x={cx(n - 1) - 10} y={lineY(last) - 10} textAnchor="end" className="fill-ink font-mono text-[13px] font-bold">
              {formatMoney(last)}
            </text>
          ) : null}
          {xAxis(LINE_PLOT_H)}
          {hitTargets(LINE_PLOT_H)}
        </svg>

        {activeDay ? (
          <div
            className="slab-sm pointer-events-none absolute top-10 z-10 w-52 p-3 text-xs"
            style={{
              left: `${tooltipLeft}%`,
              transform: `translateX(${tooltipLeft > 70 ? "-100%" : tooltipLeft < 30 ? "0" : "-50%"}) translateX(${tooltipLeft > 70 ? "-12px" : tooltipLeft < 30 ? "12px" : "0"})`,
            }}
            aria-live="polite"
          >
            <p className="font-bold">{DAY_LONG.format(parseDay(activeDay.day))}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt className="flex items-center gap-1.5">
                <span className="size-2.5" style={{ background: FIRST_COLOR }} aria-hidden />
                First judgments
              </dt>
              <dd className="tabular text-right font-bold">{formatCount(activeDay.judgments - activeDay.rerolls)}</dd>
              <dt className="flex items-center gap-1.5">
                <span className="size-2.5" style={{ background: RETRIAL_COLOR }} aria-hidden />
                Retrials
              </dt>
              <dd className="tabular text-right font-bold">{formatCount(activeDay.rerolls)}</dd>
              <dt>Paid that day</dt>
              <dd className="tabular text-right font-bold">{formatMoney(activeDay.revenueCents)}</dd>
              <dt>Running total</dt>
              <dd className="tabular text-right font-bold">{formatMoney(running[active!] ?? 0)}</dd>
            </dl>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-ink-soft">
        Last {n} days: <strong className="text-ink">{formatCount(totals.judgments)}</strong> judgments (
        {formatCount(totals.rerolls)} retrials), <strong className="text-ink">{formatMoney(totals.revenue)}</strong> paid.
      </p>

      <details className="mt-3 border-2 border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm font-bold">Show the numbers (table)</summary>
        <div className="max-h-80 overflow-auto border-t-2 border-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Judgments, retrials and revenue per day</caption>
            <thead className="sticky top-0 bg-paper-2 text-xs uppercase">
              <tr>
                <th scope="col" className="px-3 py-1.5">Day (UTC)</th>
                <th scope="col" className="px-3 py-1.5 text-right">First judgments</th>
                <th scope="col" className="px-3 py-1.5 text-right">Retrials</th>
                <th scope="col" className="px-3 py-1.5 text-right">Paid</th>
                <th scope="col" className="px-3 py-1.5 text-right">Running total</th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line/15">
              {days
                .map((d, index) => ({ d, index }))
                .reverse()
                .map(({ d, index }) => (
                  <tr key={d.day}>
                    <th scope="row" className="px-3 py-1 font-normal">{d.day}</th>
                    <td className="px-3 py-1 text-right">{d.judgments - d.rerolls}</td>
                    <td className="px-3 py-1 text-right">{d.rerolls}</td>
                    <td className="px-3 py-1 text-right">{formatMoney(d.revenueCents)}</td>
                    <td className="px-3 py-1 text-right">{formatMoney(running[index] ?? 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
