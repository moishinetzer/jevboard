import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatMoney, JUDGMENT_PRICE_CENTS } from "~/lib/format";
import { CONTACT_EMAIL } from "./faq/content";
import { focusRing } from "./shared";

export const TERMS_UPDATED = "September 30, 2026";

const price = formatMoney(JUDGMENT_PRICE_CENTS);

interface Clause {
  readonly id: string;
  readonly title: string;
  /** The one-line version, in Jev's voice. */
  readonly gist: string;
  readonly body: ReactNode;
}

const link = (to: string, label: string) => (
  <Link to={to} className={`font-bold text-ink underline ${focusRing}`}>
    {label}
  </Link>
);

export const CLAUSES: ReadonlyArray<Clause> = [
  {
    id: "what-you-buy",
    title: "What you're buying",
    gist: `${price} buys one AI evaluation. That's it.`,
    body: (
      <>
        <p>
          Each payment of {price} buys one evaluation of one website by Jev, an AI: we fetch a few of the site's public pages and Jev
          produces a summary (TL;DR), a score from 1 to 1000 and a short written verdict, published on Jevboard.
        </p>
        <p>
          A “retrial” (or “reroll”) is simply another evaluation of the same site, bought separately at the same price and judged from
          scratch.
        </p>
      </>
    ),
  },
  {
    id: "what-you-dont",
    title: "What you're not buying",
    gist: "No rank, no prize, no guarantees.",
    body: (
      <>
        <p>
          Payment does not buy a score, a rank, a position on the board, traffic, a prize or any payout. There are no prizes and nothing
          on Jevboard has cash value.
        </p>
        <p>
          Ranks change as other sites are judged. The newest verdict for a site replaces the previous one on the board, even when it is
          lower. Ties are broken by further AI comparisons (“duels”), which can move a site up or down.
        </p>
      </>
    ),
  },
  {
    id: "opinion",
    title: "Jev's output is opinion",
    gist: "Jev is confident. Jev is not always right.",
    body: (
      <p>
        Verdicts, scores, labels and roasts are automatically generated opinions, written in a deliberately playful tone. They can be
        wrong, they are not statements of fact, and they are not financial, legal or professional advice. Jev comments on websites and
        businesses, not on people.
      </p>
    ),
  },
  {
    id: "refunds",
    title: "Refunds",
    gist: "Delivered verdicts are final. Failed crawls retry for free.",
    body: (
      <p>
        Once an evaluation has been delivered, it is final and not refundable, whatever the score. If we can't reach the site to
        evaluate it (it's down, times out or blocks our crawler), no verdict is recorded and you can retry without paying again. If we
        can't deliver an evaluation at all, contact us and we'll make it right.
      </p>
    ),
  },
  {
    id: "what-you-submit",
    title: "What you may submit",
    gist: "Real, public websites you have the right to promote.",
    body: (
      <>
        <p>
          Only submit public websites that you own or otherwise have the right to promote. Don't use Jevboard to impersonate anyone,
          harass anyone, or promote anything illegal, deceptive or harmful.
        </p>
        <p>
          Don't try to manipulate the judge (for example with hidden instructions aimed at AI systems). Attempts are recorded and
          shown publicly on the verdict. See the {link("/faq#trick-jev", "FAQ")}.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "Everything is public",
    gist: "Verdicts, share cards and badges are meant to be seen.",
    body: (
      <p>
        A submitted site's address, name, score, rank and verdict are published on the Jevboard leaderboard and may appear in share
        images and embeddable badges, along with how many times its listing was viewed.
      </p>
    ),
  },
  {
    id: "moderation",
    title: "Moderation",
    gist: "We can hide things. We will hide some things.",
    body: (
      <p>
        We may decline to judge, hide or remove any site or verdict at our discretion, including adult, illegal, scam, hateful or parked
        sites and anything that is reported and breaks these terms. We may also correct errors. Sites removed for breaking these terms
        are not refunded.
      </p>
    ),
  },
  {
    id: "service",
    title: "The service",
    gist: "Provided as is. Jev has off days.",
    body: (
      <p>
        Jevboard is provided “as is”, without warranties. It may be unavailable, change or shut down. Prices for future purchases may
        change. To the extent the law allows, our total liability to you is limited to the amount you paid us in the previous 30 days.
      </p>
    ),
  },
  {
    id: "privacy",
    title: "Cookies & payments",
    gist: "One anonymous cookie. We never see your card.",
    body: (
      <p>
        We set one anonymous cookie to count visitors and to connect your purchases to your browser. There are no accounts. Payments
        are processed by our payment provider; we never see or store your card details.
      </p>
    ),
  },
];

export function TermsClause({ clause, number }: { clause: Clause; number: number }) {
  return (
    <section id={clause.id} aria-labelledby={`${clause.id}-title`} className="scroll-mt-32 border-t-[3px] border-line pt-5">
      <div className="grid gap-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
        <p className="font-display text-5xl leading-none text-ink-soft" aria-hidden>
          {String(number).padStart(2, "0")}
        </p>
        <div className="min-w-0">
          <h2 id={`${clause.id}-title`} className="font-display text-3xl uppercase leading-none">
            {clause.title}
          </h2>
          <p className="mt-2 inline-block bg-jev px-1.5 font-mono text-sm font-bold text-[#111110]">{clause.gist}</p>
          <div className="mt-3 flex flex-col gap-3 text-ink-soft [&_p]:max-w-prose">{clause.body}</div>
        </div>
      </div>
    </section>
  );
}

export const contactLine = (
  <>
    Questions, takedown requests or complaints:{" "}
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-ink underline">
      {CONTACT_EMAIL}
    </a>
    .
  </>
);
