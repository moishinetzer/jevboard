import type { CSSProperties } from "react";
import type { BoardSort } from "~/.server/services/Board";

/** The board's URL state: `/?sort=today&q=ai&category=Fintech&page=2`. */
export interface BoardFilters {
  readonly sort: BoardSort;
  readonly page: number;
  readonly query: string;
  readonly category: string;
}

/** The fields a board row / podium card needs from a `BoardEntry`. */
export interface BoardRowEntry {
  readonly siteKey: string;
  readonly host: string;
  readonly name: string;
  readonly tldr: string;
  readonly category: string;
  readonly label: string;
  readonly score: number;
  readonly rank: number;
  readonly rolls: number;
  readonly bestScore: number;
  readonly worstScore: number;
  readonly lastDelta: number;
  readonly manipulationAttempt: boolean;
  readonly entryNumber: number;
  readonly clicks: number;
  readonly firstJudgedAt: number;
  readonly lastJudgedAt: number;
}

export const SORT_TABS = [
  { sort: "rank", label: "All-time", blurb: "Every business Jev has judged, ranked by usefulness. Earned, not bought." },
  { sort: "today", label: "Today", blurb: "Judged or retried in the last 24 hours." },
  { sort: "week", label: "This week", blurb: "Judged or retried in the last 7 days." },
  { sort: "newest", label: "Newest", blurb: "Fresh verdicts, still warm from the bench." },
  { sort: "rerolled", label: "Most rerolled", blurb: "Jev's most persistent defendants. Every 🎲 is another $5 and another shot." },
] as const satisfies ReadonlyArray<{ sort: BoardSort; label: string; blurb: string }>;

export const FOUNDING_LIMIT = 100;

/**
 * Builds a home URL for the given board filters. Changing anything but the
 * page resets pagination; empty/default values are left out so shared URLs
 * stay short. Lands on the board (`#board`) unless told otherwise.
 */
export const homeHref = (filters: BoardFilters, patch: Partial<BoardFilters> = {}, hash = "#board"): string => {
  const next = { ...filters, page: 1, ...patch };
  const params = new URLSearchParams();
  if (next.sort !== "rank") params.set("sort", next.sort);
  if (next.query) params.set("q", next.query);
  if (next.category) params.set("category", next.category);
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return `/${search ? `?${search}` : ""}${hash}`;
};

/** Keyboard focus ring shared by the home page's links and buttons. */
export const focusRing = "outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-hot";

/**
 * Pins the light-theme tokens on a surface that is always yellow (Jev's
 * bench, the #1 card), so borders, cards and muted text stay dark-on-yellow
 * in dark mode too.
 */
export const ON_JEV: CSSProperties = {
  ["--ink" as string]: "#111110",
  ["--ink-soft" as string]: "#4a463d",
  ["--line" as string]: "#111110",
  ["--card" as string]: "#fffdf6",
  ["--paper" as string]: "#fbf6e7",
  ["--color-ink" as string]: "#111110",
  ["--color-ink-soft" as string]: "#4a463d",
  ["--color-line" as string]: "#111110",
  ["--color-card" as string]: "#fffdf6",
  ["--color-paper" as string]: "#fbf6e7",
  background: "var(--jev)",
  color: "#111110",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A ticking reign clock: "2d 04h 13m 07s". */
export const formatReign = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  return days > 0 ? `${days}d ${clock}` : clock;
};

/** "Judgment №012" style serial. */
export const serial = (n: number): string => `№${String(n).padStart(3, "0")}`;

/** Focuses the $5 URL field (after the browser has scrolled to #judge). */
export const focusJudgeInput = () => {
  requestAnimationFrame(() => document.getElementById("judge-url")?.focus({ preventScroll: true }));
};

/**
 * A solid highlighter block. Unlike the shared `.highlight` (a half-height
 * band that inherits the text colour), it pins dark ink on yellow, so it stays
 * readable in dark mode too.
 */
export const MARKER = "bg-jev px-1 text-[#111110] box-decoration-clone";
