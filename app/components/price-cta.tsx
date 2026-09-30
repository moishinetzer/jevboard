import type { Wallet } from "~/.server/flows/shell";
import type { PriceVariant } from "~/lib/experiments";
import { formatCount } from "~/lib/format";

/**
 * The price test (PostHog flag `price-display`), shared by the home page's
 * form and the guided onboarding's last step:
 * - control: "$5, once" in the small print under the button (today's look)
 * - prominent: a $5 badge above the button, and the price on the button
 * - hidden: no price until Stripe's checkout
 */
export interface Pricing {
  readonly variant: PriceVariant;
  readonly wallet: Wallet;
  /** The board's views, for the small print. */
  readonly views: number;
}

export const priceButtonLabel = (variant: PriceVariant, label = "Get my ranking"): string =>
  variant === "prominent" ? `${label} · $5` : label;

const WALLET_TEXT: Record<Wallet, string> = {
  apple: "Apple Pay or card",
  google: "Google Pay or card",
  card: "Pay by card",
};

/** Only the prominent variant shows it: the price, said plainly, above the button. */
export function PriceBadge({ variant, className }: { variant: PriceVariant; className?: string }) {
  if (variant !== "prominent") return null;
  return (
    <p className={`inline-flex items-center gap-2 rounded-full bg-pill py-1.5 pr-3.5 pl-1.5 text-[13px] font-semibold ${className ?? ""}`}>
      <span className="rounded-full bg-jev px-2.5 py-0.5 font-display text-[15px] font-extrabold text-on-jev">$5</span>
      One ranking. No subscription.
    </p>
  );
}

/** "$5, once · Apple Pay or card · 1,314 views this week", adjusted to the variant and the device. */
export function PayLine({ pricing, className }: { pricing: Pricing; className?: string }) {
  const lead = pricing.variant === "control" ? "$5, once" : pricing.variant === "prominent" ? "Paid once" : null;
  const parts = [lead, WALLET_TEXT[pricing.wallet], pricing.views > 0 ? `${formatCount(pricing.views)} views this week` : null];
  return <p className={`text-xs text-soft sm:text-[13px] ${className ?? ""}`}>{parts.filter(Boolean).join(" · ")}</p>;
}
