/** Presentation helpers shared by routes, components, OG images and badges. */

export const JUDGMENT_PRICE_CENTS = 500;

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const formatCount = (n: number): string => new Intl.NumberFormat("en-US").format(n);

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

export const faviconUrl = (host: string, size = 64): string =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago", "last month"… for a past timestamp. */
export const timeAgo = (then: number, now: number = Date.now()): string => {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return days < 730 ? "last year" : `${Math.floor(days / 365)} years ago`;
};
