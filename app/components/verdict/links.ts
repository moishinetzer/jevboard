/** URL helpers for everything hanging off a site key (board link, redirects, OG cards). */

const encodeKey = (siteKey: string): string =>
  siteKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

/** Outbound link that counts the visit ("Jev sent N visitors"). */
export const goPath = (siteKey: string): string => `/go/${encodeKey(siteKey)}`;

/** Dynamic share card. */
export const ogPath = (siteKey: string): string => `/og/${encodeKey(siteKey)}.png`;
