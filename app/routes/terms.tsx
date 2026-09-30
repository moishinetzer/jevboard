import { CONTACT_EMAIL } from "~/components/pages/faq/content";
import { pageMeta } from "~/components/pages/meta";
import { CLAUSES, TERMS_UPDATED, TermsClause } from "~/components/pages/terms";
import { PageHeader } from "~/components/shell";
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
    <>
      <PageHeader />
      <main className="mx-auto w-full max-w-[732px] px-4 pt-12 sm:pt-[60px]">
        <h1 className="headline text-[40px] sm:text-[56px]">Terms</h1>
        <p className="mt-2.5 text-base text-soft">
          Updated {TERMS_UPDATED}. Plain language, the short version first. The boring thing here: you pay for an AI evaluation of a
          website.
        </p>
        <ol className="mt-9 flex list-none flex-col gap-3.5 p-0">
          {CLAUSES.map((clause, index) => (
            <TermsClause key={clause.id} clause={clause} number={index + 1} />
          ))}
        </ol>
        <p className="mt-[26px] text-sm text-soft">
          Questions about these terms?{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="link">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2 text-[13px] text-soft">
          By paying for an evaluation you agree to these terms, and the version in force when you paid applies to that purchase.
        </p>
      </main>
    </>
  );
}
