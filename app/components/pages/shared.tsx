import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { Favicon } from "~/components/ui";
import { formatDuration } from "~/lib/format";
import { entryPath } from "~/lib/site-key";

/** Keyboard focus ring for links and buttons on the content pages. */
export const focusRing = "outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-hot";

/**
 * Pins light-theme tokens on an always-yellow surface so borders and muted
 * text stay dark-on-yellow in dark mode too.
 */
export const ON_JEV: CSSProperties = {
  ["--ink" as string]: "#111110",
  ["--ink-soft" as string]: "#4a463d",
  ["--line" as string]: "#111110",
  ["--card" as string]: "#fffdf6",
  ["--paper" as string]: "#fbf6e7",
  background: "var(--jev)",
  color: "#111110",
};

/**
 * Pins dark-theme tokens on an always-dark surface (TV mode, ink bands), so
 * `text-ink`, `border-line`, `.slab` etc. read correctly on black in light mode too.
 */
export const ON_INK: CSSProperties = {
  ["--paper" as string]: "#12110e",
  ["--paper-2" as string]: "#1b1a15",
  ["--ink" as string]: "#f6f1e1",
  ["--ink-soft" as string]: "#b9b2a0",
  ["--card" as string]: "#1a1914",
  ["--line" as string]: "#f6f1e1",
  ["--shadow" as string]: "#000000",
  background: "#111110",
  color: "#f6f1e1",
  colorScheme: "dark",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A ticking reign clock: "2d 04h 13m 07s". */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const clock = `${pad(Math.floor((total % 86_400) / 3600))}h ${pad(Math.floor((total % 3600) / 60))}m ${pad(total % 60)}s`;
  return days > 0 ? `${days}d ${clock}` : clock;
};

/** Reign lengths: sub-minute reigns happen (instant dethronings) and deserve a name. */
export const formatReignLength = (ms: number): string => (ms < 60_000 ? "under a minute" : formatDuration(ms));

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Server/client-stable timestamps (always UTC, so hydration never disagrees). */
export const formatDateTime = (epochMs: number): string => `${DATE_TIME.format(epochMs)} UTC`;
export const formatDate = (epochMs: number): string => DATE.format(epochMs);

/** Big page masthead: kicker, display headline, standfirst. */
export function PageMasthead({
  kicker,
  title,
  children,
  aside,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b-[3px] border-line bg-paper-2">
      <div className="halftone pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:py-14 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-hot">{kicker}</p>
          <h1 className="mt-2 font-display text-5xl uppercase leading-[0.9] break-words sm:text-7xl lg:text-8xl">{title}</h1>
          {children ? <div className="mt-5 max-w-2xl text-lg text-ink-soft sm:text-xl">{children}</div> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </header>
  );
}

/** A numbered courtroom "exhibit" section with an anchor id. */
export function Exhibit({
  id,
  letter,
  title,
  blurb,
  children,
  className,
}: {
  id: string;
  letter: string;
  title: ReactNode;
  blurb?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-32 ${className ?? ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-[3px] border-line pb-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-ink-soft">Exhibit {letter}</p>
          <h2 id={`${id}-title`} className="mt-1 font-display text-4xl uppercase leading-none sm:text-5xl">
            {title}
          </h2>
        </div>
        {blurb ? <p className="max-w-md text-sm text-ink-soft">{blurb}</p> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Deadpan empty state. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-2 border-dashed border-line px-4 py-6 text-center font-mono text-sm text-ink-soft">{children}</p>
  );
}

/** Favicon + site key, linking to the verdict page. */
export function SiteLink({ siteKey, size = 24, className }: { siteKey: string; size?: number; className?: string }) {
  return (
    <Link
      to={entryPath(siteKey)}
      className={`group inline-flex min-w-0 items-center gap-2 font-bold ${focusRing} ${className ?? ""}`}
    >
      <Favicon host={siteKey.split("/")[0]!} size={size} />
      <span className="truncate group-hover:underline">{siteKey}</span>
    </Link>
  );
}

/** A stamped, rotated label ("SHAME", "BRIBERY"). */
export function Stamp({ children, tone = "hot", className }: { children: ReactNode; tone?: "hot" | "ink"; className?: string }) {
  return (
    <span
      className={`inline-block -rotate-6 border-[3px] px-2 py-0.5 font-display text-lg uppercase leading-none tracking-wide ${
        tone === "hot" ? "border-hot text-hot" : "border-line text-ink"
      } ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/** Chip navigation to a page's sections. */
export function JumpNav({ items, label }: { items: ReadonlyArray<{ id: string; label: string }>; label: string }) {
  return (
    <nav aria-label={label} className="mx-auto max-w-7xl px-4 pt-6">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`inline-block border-2 border-line bg-card px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-jev hover:text-[#111110] ${focusRing}`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
