import type { BoardData } from "~/.server/flows/board";

/**
 * The last board the server sent. Every listed business arrives with its
 * opened row, so the route's clientLoader answers opening, closing and
 * back/forward from here without a round trip. Browser only: BoardPage
 * remembers the data in an effect, which never runs on the server.
 */
let last: BoardData | null = null;

export const rememberBoard = (data: BoardData): void => {
  last = data;
};

/** Notices that belong to one page load, not to rows opened afterwards. */
const quiet = { checkoutCancelled: false, cancelledSite: null } as const;

/** The board with `siteKey` opened in place, when that business is on the page we have. */
export const boardWithOpen = (siteKey: string): BoardData | null => {
  const entry = last?.listing.entries.find((candidate) => candidate.siteKey === siteKey);
  return last && entry ? { ...last, ...quiet, open: entry } : null;
};

/** Page `page` of the board with nothing opened, when it's the page we have. */
export const boardClosed = (page: number): BoardData | null =>
  last && last.listing.page === page ? { ...last, ...quiet, open: null } : null;

/** Counts a view of a row opened in the browser (the server counts /s/<site> page loads itself). */
export const reportRowView = (siteKey: string): void => {
  const body = new URLSearchParams({ site: siteKey });
  try {
    if (navigator.sendBeacon("/api/view", body)) return;
  } catch {
    // Some browsers throw instead of returning false; fall through to fetch.
  }
  void fetch("/api/view", { method: "POST", body, keepalive: true }).catch(() => undefined);
};
