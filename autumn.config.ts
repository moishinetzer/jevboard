// @ts-nocheck -- `atmn` (Autumn's CLI, v2) is not a project dependency, so this
// file is not type-checked by `tsc`. To use it: `pnpm add -D atmn@^2`, then
// `pnpm atmn push` (preview) / `pnpm atmn push --yes` (apply to the sandbox),
// adding `-p` for production. Once atmn is installed you can delete this line.
// See docs/payments.md; the app reads these ids from AUTUMN_PLAN_ID / AUTUMN_FEATURE_ID.
import { atmn, feature, plan, webhook } from "atmn";

/** One judgment credit. Granted by each purchase, consumed when Jev judges the order. */
export const judgment = feature({
  featureId: "judgment",
  name: "Judgment",
  type: "metered",
  consumable: true,
});

/**
 * $5, charged once per checkout. One-off plans can be bought any number of
 * times (every order is its own Autumn customer anyway), and each purchase
 * grants exactly one `judgment` that never resets.
 */
export const judgmentPlan = plan({
  planId: "judgment",
  name: "Jev Judgment",
  description: "One judgment of one website by Jev: a verdict and a 1-1000 score on the public leaderboard.",
  active: true,
  addOn: true,
  price: { amount: 5, interval: "one_off" },
  items: [{ featureId: judgment.featureId, included: 1 }],
});

// Optional: manage the webhook here too. Only included when AUTUMN_WEBHOOK_URL
// is set (https, public — e.g. https://jevboard.com/api/autumn/webhook), so a
// plain push leaves your webhooks alone. atmn writes the new endpoint's signing
// secret to your env file as AUTUMN_WEBHOOK_JEVBOARD_<ENV>_SECRET: copy it into
// AUTUMN_WEBHOOK_SECRET for the app.
const webhookUrl = process.env.AUTUMN_WEBHOOK_URL;

export default atmn({
  features: [judgment],
  plans: [judgmentPlan],
  ...(webhookUrl
    ? {
        webhooks: [
          webhook({
            id: "jevboard",
            env: process.env.AUTUMN_WEBHOOK_ENV ?? "sandbox",
            url: webhookUrl,
            events: ["billing.updated"],
            description: "Jevboard: start judgments for paid orders",
          }),
        ],
      }
    : {}),
});
