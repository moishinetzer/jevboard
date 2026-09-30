/**
 * The two live tests (PostHog feature flags), shared by the server, which
 * assigns them, and the pages, which show them.
 */

/** The PostHog feature flags behind the two live tests. */
export const FLAGS = { onboarding: "onboarding-flow", price: "price-display" } as const;

export const ONBOARDING_VARIANTS = ["control", "guided"] as const;
export const PRICE_VARIANTS = ["control", "prominent", "hidden"] as const;
export type OnboardingVariant = (typeof ONBOARDING_VARIANTS)[number];
export type PriceVariant = (typeof PRICE_VARIANTS)[number];

export interface Variants {
  /** Test B: the plain form, or Jev's five-step onboarding with payment last. */
  readonly onboarding: OnboardingVariant;
  /** How loudly the $5 is shown: small print, prominent, or not until checkout. */
  readonly price: PriceVariant;
  /**
   * Which of the two PostHog assigned. When it was off, slow or unreachable
   * the visitor sees the defaults and is left out of that test (no exposure).
   */
  readonly assigned: { readonly onboarding: boolean; readonly price: boolean };
}

export const DEFAULT_VARIANTS: Variants = { onboarding: "control", price: "control", assigned: { onboarding: false, price: false } };


/** The allowed value for a flag, or undefined. */
export const pick = <A extends string>(allowed: ReadonlyArray<A>, value: string | null | undefined): A | undefined =>
  allowed.find((candidate) => candidate === value);

/** Variants forced by name, e.g. "onboarding=guided,price=hidden" (local development and QA). */
export const parseVariantOverride = (text: string): Partial<Pick<Variants, "onboarding" | "price">> => {
  const pairs = new Map(
    text
      .split(/[,&\s]+/)
      .map((pair) => pair.split("=").map((part) => part.trim().toLowerCase()) as [string, string | undefined])
      .filter(([key, value]) => key !== "" && value !== undefined),
  );
  const onboarding = pick(ONBOARDING_VARIANTS, pairs.get("onboarding"));
  const price = pick(PRICE_VARIANTS, pairs.get("price"));
  return { ...(onboarding ? { onboarding } : {}), ...(price ? { price } : {}) };
};

