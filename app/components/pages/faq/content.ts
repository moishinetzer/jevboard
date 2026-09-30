/**
 * The FAQ, in Jev's voice. Answers are plain paragraphs so the same text
 * feeds the page and the FAQPage JSON-LD.
 */

/** Placeholder contact address, used by the FAQ and the terms. Set before launch. */
export const CONTACT_EMAIL = "hello@jevboard.com";

export interface FaqItem {
  readonly id: string;
  readonly question: string;
  readonly answer: ReadonlyArray<string>;
  readonly links?: ReadonlyArray<{ readonly to: string; readonly label: string }>;
}

export interface FaqGroup {
  readonly id: string;
  readonly title: string;
  readonly items: ReadonlyArray<FaqItem>;
}

export const FAQ: ReadonlyArray<FaqGroup> = [
  {
    id: "the-court",
    title: "The court",
    items: [
      {
        id: "who-is-jev",
        question: "Who is Jev?",
        answer: [
          "An AI judge with a 1–1000 scale, a crawler and no friends in the industry.",
          "Jev reads your website the way a busy stranger would, writes the TL;DR you should have written, and decides how useful your business actually is. Then Jev puts the number on a public leaderboard, because Jev believes in accountability. Mostly yours.",
        ],
      },
      {
        id: "what-to-tell-jev",
        question: "What do I have to tell Jev?",
        answer: [
          "Nothing. Paste your URL and pay. If your website can't explain your business, that is the verdict.",
          "No forms, no pitch deck, no “additional context”. Jev only knows what your public pages say, which is exactly what your customers know.",
        ],
      },
      {
        id: "what-jev-looks-at",
        question: "What does Jev actually look at?",
        answer: [
          "Your homepage and a handful of pages it links to on the same site: about, pricing, docs and the like. Jev looks for what you do, who it's for, what it costs and any proof that it works.",
          "Then Jev writes a TL;DR, a score from 1 to 1000, a short roast, sub-scores and receipts: real quotes from your own pages that justify the verdict. Jev reads text. It doesn't run your JavaScript, log in, or watch your demo video.",
        ],
        links: [{ to: "#jevbot", label: "How JevBot crawls" }],
      },
      {
        id: "score-down",
        question: "Can my score go down on a retrial?",
        answer: [
          "Yes. Jev doesn't remember you, probably.",
          "Every retrial re-crawls your site and judges it from scratch, and the newest verdict stands even when it's lower. Your score can go up. It can also go down. That's the point.",
        ],
      },
      {
        id: "ties",
        question: "What happens on a tie?",
        answer: [
          "Jev doesn't do draws. If your score exactly matches another site's, you both go into the Duel Pit: Jev compares the two head-to-head and picks a winner, with a one-line reason.",
          "It repeats until every tied site has its own place.",
        ],
      },
      {
        id: "public",
        question: "Is my verdict public?",
        answer: [
          "Yes. Every business on the board is public: anyone can open its verdict, and each one has a share link and a share card. That's the whole idea: you can't buy #1, but you can show off your number.",
        ],
      },
    ],
  },
  {
    id: "the-money",
    title: "The money",
    items: [
      {
        id: "pay-more",
        question: "Can I pay more to rank higher?",
        answer: [
          "No. $5 buys a judgment, not a result.",
          "Whoever added a business can ask for a rejudge as often as they like, but each one costs the same $5, is judged from scratch, and the newest verdict is final. You can't buy #1. You can only buy Jev's attention.",
        ],
      },
      {
        id: "gambling",
        question: "Is this gambling?",
        answer: [
          "No. $5 buys an AI evaluation of your website: a crawl, a TL;DR and a verdict, delivered every time.",
          "There are no prizes, no payouts and no cash value in a rank. Just Jev's opinion, which is priceless (and costs $5).",
        ],
        links: [{ to: "/terms", label: "Read the terms" }],
      },
      {
        id: "refunds",
        question: "Refunds?",
        answer: [
          "Jev's attention, once spent, cannot be returned.",
          "But if Jev can't reach your site (it's down, it times out, it blocks JevBot), that isn't a judgment. No verdict is recorded and your retry is free.",
        ],
      },
      {
        id: "advertising",
        question: "Is this real advertising?",
        answer: [
          "Sort of. Every listing links to your site and shows how many people viewed it. What you can't buy is placement: the order of the board is Jev's opinion, not the highest bidder's.",
        ],
      },
    ],
  },
  {
    id: "fair-play",
    title: "Fair play",
    items: [
      {
        id: "trick-jev",
        question: "Can I trick Jev with hidden instructions on my site?",
        answer: [
          "You can try. Jev reads hidden text too.",
          "Pages that try to instruct, flatter or bribe an AI judge (say, white-on-white text begging for a 1000) get a permanent 🚨 stamp on their verdict. Jev judges the site anyway, minus the bump you were hoping for.",
        ],
      },
      {
        id: "declined",
        question: "Why is a site missing from the board?",
        answer: [
          "Jev declines to list adult, illegal, scam, hateful and parked sites. They're judged like everyone else; they just don't get a spot on the public board. We may also remove sites that are reported and break the terms.",
        ],
      },
      {
        id: "someone-else",
        question: "Someone submitted my site. Can I get it removed?",
        answer: [
          `Anyone can ask Jev about a public website, the same way anyone can review a restaurant. If a verdict is abusive, wrong about facts, or you'd rather not be on the board, email ${CONTACT_EMAIL} and a human will take a look.`,
        ],
      },
      {
        id: "why-jevboard",
        question: "Why is it called Jevboard?",
        answer: ["Because “Board of Jev” sounded like a threat."],
      },
    ],
  },
];

/** schema.org FAQPage for rich results. */
export const faqJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.flatMap((group) =>
    group.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer.join(" ") },
    })),
  ),
});
