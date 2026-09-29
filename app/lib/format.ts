/** Presentation helpers shared by routes, components, OG images and badges. */

export interface ScoreTier {
  readonly min: number;
  readonly label: string;
  readonly emoji: string;
  /** Background colour for chips / cards (works on both themes). */
  readonly color: string;
  readonly ink: string;
}

export const SCORE_TIERS: ReadonlyArray<ScoreTier> = [
  { min: 950, label: "Civilizational", emoji: "👑", color: "#ffd400", ink: "#111110" },
  { min: 850, label: "Essential", emoji: "💎", color: "#7cf0c5", ink: "#111110" },
  { min: 700, label: "Genuinely Useful", emoji: "🔥", color: "#ff9f1c", ink: "#111110" },
  { min: 500, label: "Solid", emoji: "👍", color: "#9ec5ff", ink: "#111110" },
  { min: 300, label: "Niche", emoji: "🤏", color: "#d6c8ff", ink: "#111110" },
  { min: 150, label: "Questionable", emoji: "🤨", color: "#ffb3a7", ink: "#111110" },
  { min: 1, label: "Why Does This Exist", emoji: "💀", color: "#ff3b1f", ink: "#ffffff" },
];

export const tierFor = (score: number): ScoreTier =>
  SCORE_TIERS.find((tier) => score >= tier.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1]!;

export const JUDGMENT_PRICE_CENTS = 500;

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const formatCount = (n: number): string => new Intl.NumberFormat("en-US").format(n);

export const ordinal = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 minutes ago" style relative time. `now` is injectable for SSR stability. */
export const timeAgo = (epochMs: number, now: number = Date.now()): string => {
  const seconds = Math.round((epochMs - now) / 1000);
  if (Math.abs(seconds) < 10) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

/** "3d 4h" style duration for reign lengths. */
export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export const formatDelta = (delta: number): string =>
  delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";

export const faviconUrl = (host: string, size = 64): string =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
