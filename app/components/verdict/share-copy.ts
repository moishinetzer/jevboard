/**
 * Prefilled share text. The business brags (or confesses); spectators gossip.
 * Every template is short enough for one post and ends with the verdict URL.
 */

export type ShareVoice = "defendant" | "spectator";

export interface ShareFacts {
  readonly siteKey: string;
  readonly rank: number;
  readonly total: number;
  /** Absolute URL of the business on the board. */
  readonly url: string;
}

export interface ShareMessage {
  /** Text without the URL (for navigator.share, which takes the URL separately). */
  readonly body: string;
  /** Text with the URL appended (X, clipboard). */
  readonly full: string;
}

const defendantBody = (f: ShareFacts): string => {
  if (f.rank === 1) {
    return `${f.siteKey} is #1 on Ranked by Jev, where an AI judges how useful your business really is. Think you can beat us? Prove it for $5:`;
  }
  if (f.rank <= 10) return `An AI judge put ${f.siteKey} at #${f.rank} on Ranked by Jev. Come at us:`;
  return `Paid $5 to have an AI judge how useful my business is. #${f.rank} of ${f.total} on Ranked by Jev. Worth it.`;
};

const spectatorBody = (f: ShareFacts): string =>
  f.rank === 1
    ? `${f.siteKey} is #1 on Ranked by Jev. The judge is an AI. Agree?`
    : `An AI judge put ${f.siteKey} at #${f.rank} of ${f.total} on Ranked by Jev. Agree?`;

export const shareMessage = (facts: ShareFacts, voice: ShareVoice): ShareMessage => {
  const body = voice === "defendant" ? defendantBody(facts) : spectatorBody(facts);
  return { body, full: `${body} ${facts.url}` };
};

export const xIntentUrl = (text: string): string => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
