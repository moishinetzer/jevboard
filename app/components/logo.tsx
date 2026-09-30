const INK = "#1d1b16";

/**
 * Jev, the judge: a yellow face with a monocle and a tiny crown. `flat` is the
 * unimpressed mouth (nothing found). Pure SVG so it also renders in OG images.
 */
export function JevFace({
  size = 40,
  mood = "smile",
  label = "Jev",
  className,
}: {
  size?: number;
  mood?: "smile" | "flat";
  label?: string;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={label}>
      <path d="M18 14 L24 4 L32 12 L40 4 L46 14 Z" fill="#ffd400" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="32" cy="36" r="24" fill="#ffd400" stroke={INK} strokeWidth="3.5" />
      <circle cx="23" cy="33" r="4" fill={INK} />
      <circle cx="41" cy="33" r="7.5" fill="#fffdf6" stroke={INK} strokeWidth="3" />
      <circle cx="41" cy="33" r="3.2" fill={INK} />
      <path d="M48 38 Q52 46 50 54" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M17 26 L28 28" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M35 25 L47 23" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      {mood === "flat" ? (
        <path d="M24 47 L40 47" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
      ) : (
        <path d="M23 46 Q32 42 41 46" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={`font-display font-bold tracking-[-0.02em] leading-none ${className ?? ""}`}>jevboard</span>;
}

export type Medal = "gold" | "silver" | "bronze";

export const medalFor = (rank: number): Medal | null =>
  rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;

const CROWN_FILL: Record<Medal, string> = { gold: "#fff4b8", silver: "#c9ced6", bronze: "#d0894a" };

/** The little crown on the top three. */
export function Crown({ medal, width = 14, className }: { medal: Medal; width?: number; className?: string }) {
  return (
    <svg
      width={width}
      height={(width * 18) / 26}
      viewBox="0 0 26 18"
      className={className}
      role="img"
      aria-label={`${medal[0]!.toUpperCase()}${medal.slice(1)} crown`}
    >
      <path
        d="M2 16 L4 4 L9 10 L13 2 L17 10 L22 4 L24 16 Z"
        fill={CROWN_FILL[medal]}
        stroke={INK}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Tailwind classes for a top-three row or pill: tinted background and border. */
export const MEDAL_TINT: Record<Medal, string> = {
  gold: "bg-gold-bg border-gold-line",
  silver: "bg-silver-bg border-silver-line",
  bronze: "bg-bronze-bg border-bronze-line",
};

/** The solid badge colour behind "#1" / "#2" / "#3". */
export const MEDAL_BADGE: Record<Medal, string> = {
  gold: "bg-[#ffd400]",
  silver: "bg-[#dfe3e8]",
  bronze: "bg-[#f0cfae]",
};

/** "#3" with its crown for the top three, plain "#12" otherwise. */
export function RankBadge({ rank, size = "md" }: { rank: number; size?: "sm" | "md" }) {
  const medal = medalFor(rank);
  if (!medal) {
    return <span className={`font-semibold text-soft tabular-nums ${size === "sm" ? "text-sm" : "text-[15px]"}`}>#{rank}</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold text-on-jev tabular-nums ${MEDAL_BADGE[medal]} ${
        size === "sm" ? "gap-[3px] px-[7px] py-[3px] text-xs" : "gap-1 px-[9px] py-1 text-[13px]"
      }`}
    >
      <Crown medal={medal} width={size === "sm" ? 12 : 14} />#{rank}
    </span>
  );
}
