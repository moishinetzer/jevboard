import { Context, type Effect } from "effect";
import type { JudgeError } from "../domain/errors";
import type { DuelContender, DuelVerdict, SiteSnapshot, Verdict } from "../domain/models";

export interface JudgeInput {
  readonly siteKey: string;
  readonly url: string;
  readonly snapshot: SiteSnapshot;
  /** 1 for a first judgment, 2+ for rerolls. */
  readonly roll: number;
  /** Rerolls ask Jev to bypass any fetch cache and look at the live site again. */
  readonly fresh: boolean;
}

export interface JudgeResult {
  readonly verdict: Verdict;
  /** Model id that produced the verdict (e.g. "claude-opus-5-5" or "mock-jev"). */
  readonly model: string;
  /** URLs Jev fetched itself with its web tool while judging (may be empty). */
  readonly pagesFetchedByJev: ReadonlyArray<string>;
}

export interface DuelInput {
  /** The exact score both contenders share. */
  readonly score: number;
  readonly a: DuelContender;
  readonly b: DuelContender;
}

/**
 * Jev himself. Produces verdicts (1-1000 usefulness scores with a TL;DR and a
 * roast) and settles exact-score ties through head-to-head duels.
 */
export class Judge extends Context.Service<
  Judge,
  {
    /** "claude" in production, "mock" when no API key is configured. */
    readonly kind: "claude" | "mock";
    readonly judge: (input: JudgeInput) => Effect.Effect<JudgeResult, JudgeError>;
    readonly duel: (input: DuelInput) => Effect.Effect<DuelVerdict, JudgeError>;
  }
>()("jevboard/Judge") {}
