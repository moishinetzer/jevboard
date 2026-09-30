import { Context, type Effect } from "effect";
import type { JudgeError } from "../domain/errors";
import type { DuelContender, DuelVerdict, Intake, SitePreview, SiteSnapshot, Verdict } from "../domain/models";

export interface JudgeInput {
  readonly siteKey: string;
  readonly url: string;
  readonly snapshot: SiteSnapshot;
  /** 1 for a first judgment, 2+ for rerolls. */
  readonly roll: number;
  /** What the buyer claimed in the guided onboarding, for Jev to check against the site. */
  readonly intake?: Intake | null;
}

export interface PreviewInput {
  readonly siteKey: string;
  readonly snapshot: SiteSnapshot;
}

export interface JudgeResult {
  readonly verdict: Verdict;
  /** Model id that produced the verdict (e.g. "openai/gpt-6-luna" or "mock-jev"). */
  readonly model: string;
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
    /** "live" (OpenRouter) in production, "mock" when no API key is configured. */
    readonly kind: "live" | "mock";
    readonly judge: (input: JudgeInput) => Effect.Effect<JudgeResult, JudgeError>;
    readonly duel: (input: DuelInput) => Effect.Effect<DuelVerdict, JudgeError>;
    /** The guided onboarding's read of a site, before anyone pays: no score, no rank. */
    readonly preview: (input: PreviewInput) => Effect.Effect<SitePreview, JudgeError>;
  }
>()("jevboard/Judge") {}
