import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatMoney, JUDGMENT_PRICE_CENTS } from "~/lib/format";

/** Shown as "Updated 30 September 2026." at the top of the terms. */
export const TERMS_UPDATED = "30 September 2026";

const price = formatMoney(JUDGMENT_PRICE_CENTS);

interface Clause {
  /** Anchor id, so `/terms#<id>` lands on this clause. */
  readonly id: string;
  readonly title: string;
  /** The one-line version, in Jev's voice. */
  readonly gist: string;
  readonly body: ReactNode;
}

export const CLAUSES: ReadonlyArray<Clause> = [
  {
    id: "what-you-buy",
    title: "What you're buying",
    gist: `${price} buys one AI evaluation. That's it.`,
    body: "Each payment buys one evaluation of one website by Jev, an AI: we fetch a few of the site's public pages and Jev writes a summary and a short verdict and places the site on the public board. A rejudge is another evaluation of the same site, bought separately at the same price and judged from scratch.",
  },
  {
    id: "what-you-dont",
    title: "What you're not buying",
    gist: "No rank, no prize, no guarantees.",
    body: "Payment does not buy a rank, a position on the board, traffic, a prize or any payout. Ranks change as other sites are judged. The newest verdict for a site replaces the previous one, even when it's worse. Exact ties are ordered by further AI comparisons.",
  },
  {
    id: "opinion",
    title: "Jev's output is opinion",
    gist: "Jev is confident. Jev is not always right.",
    body: "Verdicts and summaries are automatically generated opinions, written in a playful tone. They can be wrong, they are not statements of fact, and they are not financial, legal or professional advice. Jev comments on websites and businesses, not on people.",
  },
  {
    id: "refunds",
    title: "If Jev can't reach your site",
    gist: "A delivered verdict is final. A failed crawl retries for free.",
    body: "Once an evaluation is delivered it is final, whatever the result. If we can't reach the site (it's down, times out or blocks our crawler), no verdict is recorded and you can retry without paying again. If we can't deliver at all, contact us and we'll make it right.",
  },
  {
    id: "what-you-submit",
    title: "What you may submit",
    gist: "Real, public websites you have the right to promote.",
    body: (
      <>
        Only submit public websites you own or may promote. Don't use Jevboard to impersonate or harass anyone, or to promote anything
        illegal, deceptive or harmful. Don't try to{" "}
        <Link to="/faq#trick-jev" className="link">
          manipulate the judge
        </Link>
        ; attempts are recorded and shown on the verdict.
      </>
    ),
  },
  {
    id: "public",
    title: "Everything is public",
    gist: "Verdicts and share cards are meant to be seen.",
    body: "A submitted site's address, name, rank and verdict are published on the leaderboard and may appear in share images and badges, along with how many times its listing was viewed.",
  },
  {
    id: "moderation",
    title: "Moderation",
    gist: "We can hide things. We will hide some things.",
    body: "We may decline to judge, hide or remove any site or verdict, including adult, illegal, scam, hateful or parked sites and anything reported that breaks these terms. Sites removed for breaking these terms are not refunded.",
  },
  {
    id: "service",
    title: "The service",
    gist: "Provided as is. Jev has off days.",
    body: "Jevboard is provided as is, without warranties. It may be unavailable, change or shut down, and future prices may change. As far as the law allows, our total liability is limited to what you paid us in the previous 30 days.",
  },
  {
    id: "privacy",
    title: "Cookies and payments",
    gist: "One anonymous cookie. We never see your card.",
    body: "One anonymous cookie counts visitors and links your purchases to your browser. There are no accounts. Payments are handled by our payment provider; we never see or store your card details.",
  },
];

/** One numbered clause card: number, title, the gist, then the detail. */
export function TermsClause({ clause, number }: { clause: Clause; number: number }) {
  return (
    <li id={clause.id} className="panel scroll-mt-6 rounded-[20px] px-5 py-5 sm:px-[26px] sm:py-[22px]">
      <p className="text-[13px] font-bold text-accent">{String(number).padStart(2, "0")}</p>
      <h2 className="mt-1 font-display text-xl leading-snug font-bold sm:text-[22px]">{clause.title}</h2>
      <p className="mt-1.5 text-base font-semibold">{clause.gist}</p>
      <p className="mt-2 text-[15px] leading-[1.6] text-soft">{clause.body}</p>
    </li>
  );
}
