/**
 * Prefilled share text. The defendant brags (or confesses); spectators gossip.
 * Every template is short enough for one post and ends with the verdict URL.
 */

/** At or above this, the verdict is something to brag about. */
export const HIGH_SCORE = 600;

export const isHighScore = (score: number): boolean => score >= HIGH_SCORE;

export type ShareVoice = "defendant" | "spectator";

export interface ShareFacts {
  readonly siteKey: string;
  readonly score: number;
  readonly rank: number;
  readonly total: number;
  readonly label: string;
  /** Absolute URL of the verdict page. */
  readonly url: string;
  readonly rolls?: number;
  readonly previousScore?: number | null;
  /** Set when this verdict just won a tiebreak duel against that site. */
  readonly duelWonAgainst?: string | null;
}

export interface ShareMessage {
  /** Text without the URL (for navigator.share, which takes the URL separately). */
  readonly body: string;
  /** Text with the URL appended (X, clipboard). */
  readonly full: string;
}

const defendantBody = (f: ShareFacts): string => {
  if (f.rank === 1) {
    return `Jev ranks ${f.siteKey} #1 of ${f.total} on Jevboard: ${f.score}/1000, '${f.label}'. Dethrone us if you can:`;
  }
  if (f.duelWonAgainst) {
    return `Tied at ${f.score}. Jev put us in the Duel Pit with ${f.duelWonAgainst}. We won.`;
  }
  const retrials = (f.rolls ?? 1) - 1;
  if (retrials >= 2 && f.previousScore != null && f.score > f.previousScore) {
    return `${retrials} retrials later, Jev finally respects us: ${f.previousScore} → ${f.score}.`;
  }
  if (isHighScore(f.score)) {
    return `Jev rated ${f.siteKey} ${f.score}/1000 (#${f.rank} of ${f.total}). Apparently we're '${f.label}'. Come at us:`;
  }
  return `Paid $5 to have an AI tell me my startup is '${f.label}'. ${f.score}/1000. Worth it.`;
};

const spectatorBody = (f: ShareFacts): string => {
  if (f.rank === 1) return `${f.siteKey} is #1 on Jevboard with ${f.score}/1000. Jev calls it '${f.label}'.`;
  if (isHighScore(f.score)) return `Jev rated ${f.siteKey} ${f.score}/1000 (#${f.rank} of ${f.total}): '${f.label}'. Agree?`;
  return `Jev just called ${f.siteKey} '${f.label}'. ${f.score}/1000. Brutal.`;
};

export const shareMessage = (facts: ShareFacts, voice: ShareVoice): ShareMessage => {
  const body = voice === "defendant" ? defendantBody(facts) : spectatorBody(facts);
  return { body, full: `${body} ${facts.url}` };
};

export const xIntentUrl = (text: string): string => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;

export const linkedInShareUrl = (url: string): string =>
  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
