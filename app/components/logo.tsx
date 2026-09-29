/**
 * Jev, the judge. A bold circular face with a monocle and a tiny crown:
 * part oracle, part billboard mascot. Pure SVG so it also renders in OG images.
 */
export function JevFace({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Jev"
    >
      <path d="M18 14 L24 4 L32 12 L40 4 L46 14 Z" fill="#ffd400" stroke="#111110" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="32" cy="36" r="24" fill="#ffd400" stroke="#111110" strokeWidth="3.5" />
      <circle cx="23" cy="33" r="4" fill="#111110" />
      <circle cx="41" cy="33" r="7.5" fill="#fffdf6" stroke="#111110" strokeWidth="3" />
      <circle cx="41" cy="33" r="3.2" fill="#111110" />
      <path d="M48 38 Q52 46 50 54" fill="none" stroke="#111110" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 26 L28 28" stroke="#111110" strokeWidth="3" strokeLinecap="round" />
      <path d="M35 25 L47 23" stroke="#111110" strokeWidth="3" strokeLinecap="round" />
      <path d="M23 46 Q32 42 41 46" fill="none" stroke="#111110" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-display uppercase tracking-tight leading-none ${className ?? ""}`}>
      Jev<span className="text-hot">board</span>
    </span>
  );
}
