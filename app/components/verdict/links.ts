/** URL helpers for everything hanging off a site key (verdict page, redirects, OG cards, badges). */

const encodeKey = (siteKey: string): string =>
  siteKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

/** Outbound link that counts the visit ("Jev sent N visitors"). */
export const goPath = (siteKey: string): string => `/go/${encodeKey(siteKey)}`;

/** Dynamic share card. */
export const ogPath = (siteKey: string): string => `/og/${encodeKey(siteKey)}.png`;

/** Embeddable SVG badge. */
export const badgePath = (siteKey: string): string => `/badge/${encodeKey(siteKey)}.svg`;

/** "Judgment #0042". */
export const serialLabel = (serial: number): string => `#${String(serial).padStart(4, "0")}`;

/** Where the score sits in the ten-bucket histogram (0–9). */
export const bucketFor = (score: number): number => Math.max(0, Math.min(9, Math.floor((score - 1) / 100)));
