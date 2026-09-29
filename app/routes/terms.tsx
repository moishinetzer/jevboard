import { pageMeta } from "~/components/pages/meta";
import { PageMasthead } from "~/components/pages/shared";
import { CLAUSES, contactLine, TERMS_UPDATED, TermsClause } from "~/components/pages/terms";
import type { Route } from "./+types/terms";

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: "Terms",
    description:
      "Plain-language terms: each $5 buys one AI evaluation of a website. No ranks, prizes or payouts are for sale, and Jev's verdicts are opinion.",
    path: "/terms",
  });

export default function Terms() {
  return (
    <main>
      <PageMasthead
        kicker={`Terms of judgment · updated ${TERMS_UPDATED}`}
        title={
          <>
            The <span className="highlight">rules</span> of the court
          </>
        }
      >
        Short, plain and binding. The playful words on the rest of the site (“reroll”, “retrial”, “the Duel Pit”) all mean the same
        boring thing here: you pay for an AI evaluation of a website.
      </PageMasthead>

      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 pt-10">
        {CLAUSES.map((clause, index) => (
          <TermsClause key={clause.id} clause={clause} number={index + 1} />
        ))}
        <section aria-labelledby="contact-title" className="slab p-5 sm:p-6">
          <h2 id="contact-title" className="font-display text-3xl uppercase">
            Contact
          </h2>
          <p className="mt-2 text-ink-soft">{contactLine}</p>
          <p className="mt-2 text-sm text-ink-soft">
            By paying for an evaluation you agree to these terms. If they change, the version in force when you paid applies to that
            purchase.
          </p>
        </section>
      </div>
    </main>
  );
}
