import type { BoardEvent } from "~/.server/domain/models";

/** The event fields the throne history needs (keeps loader payloads small). */
export type ThroneEvent = Pick<BoardEvent, "id" | "kind" | "siteKey" | "otherSiteKey" | "score" | "createdAt">;

export interface ThroneReign {
  readonly siteKey: string;
  /** Score when crowned; the live score for the current king. */
  readonly score: number | null;
  readonly startedAt: number;
  /** null while the reign is ongoing. */
  readonly endedAt: number | null;
  /** Who took the crown next. */
  readonly dethronedBy: string | null;
  /** The king's own retrial knocked it off the throne. */
  readonly selfInflicted: boolean;
}

export interface CurrentKing {
  readonly siteKey: string;
  readonly score: number;
  readonly since: number;
}

/**
 * Rebuilds "the Reign of #1" from the event feed: every `crowned` event opens
 * a reign that lasts until the next coronation. The next king is the
 * dethroner; a `rerolled` event by the fallen king in the same instant means it
 * rerolled itself off the throne. The live king (from stats) is authoritative
 * for the current reign. Returned newest first.
 */
export const buildThroneHistory = (events: ReadonlyArray<ThroneEvent>, king: CurrentKing | null): Array<ThroneReign> => {
  const crowned = events
    .filter((event) => event.kind === "crowned" && event.siteKey !== null)
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);

  const reigns: Array<ThroneReign> = crowned.map((event, index) => {
    const next = crowned[index + 1];
    const siteKey = event.siteKey!;
    if (!next) {
      return { siteKey, score: event.score, startedAt: event.createdAt, endedAt: null, dethronedBy: null, selfInflicted: false };
    }
    const at = next.createdAt;
    const selfInflicted = events.some((e) => e.kind === "rerolled" && e.siteKey === siteKey && e.createdAt === at);
    const dethroned = events.find((e) => e.kind === "dethroned" && e.siteKey === siteKey && e.createdAt === at);
    return {
      siteKey,
      score: event.score,
      startedAt: event.createdAt,
      endedAt: at,
      dethronedBy: next.siteKey ?? dethroned?.otherSiteKey ?? null,
      selfInflicted,
    };
  });

  const last = reigns[reigns.length - 1];
  if (king) {
    if (last && last.endedAt === null && last.siteKey === king.siteKey) {
      reigns[reigns.length - 1] = { ...last, score: king.score, startedAt: Math.min(last.startedAt, king.since) };
    } else {
      if (last && last.endedAt === null) {
        reigns[reigns.length - 1] = { ...last, endedAt: Math.max(last.startedAt, king.since), dethronedBy: king.siteKey };
      }
      reigns.push({ siteKey: king.siteKey, score: king.score, startedAt: king.since, endedAt: null, dethronedBy: null, selfInflicted: false });
    }
  }

  return reigns.reverse();
};

/** Only the event kinds the throne history reads. */
export const isThroneEvent = (event: Pick<BoardEvent, "kind">): boolean =>
  event.kind === "crowned" || event.kind === "dethroned" || event.kind === "rerolled";
