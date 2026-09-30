/**
 * The FAQ, in Jev's voice. Each answer is one plain paragraph so the same
 * text feeds the page and the FAQPage JSON-LD.
 */
import { formatMoney, JUDGMENT_PRICE_CENTS } from "~/lib/format";

/** Contact address, used by the FAQ, JevBot and the terms. The FAQ links it wherever an answer mentions it. */
export const CONTACT_EMAIL = "hello@jevboard.com";

const price = formatMoney(JUDGMENT_PRICE_CENTS);

export interface FaqItem {
  /** Anchor id, so `/faq#<id>` opens this answer. */
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export const FAQ: ReadonlyArray<FaqItem> = [
  {
    id: "who-is-jev",
    question: "Who is Jev?",
    answer:
      "An AI judge with opinions and no friends in the industry. Jev reads your website the way a busy stranger would, writes the TL;DR you should have written and decides where your business ranks. Then everyone gets to see it.",
  },
  {
    id: "what-to-tell-jev",
    question: "What do I have to tell Jev?",
    answer: "Nothing. Paste your URL and pay. If your website can't explain your business, that is the verdict.",
  },
  {
    id: "what-jev-looks-at",
    question: "What does Jev look at?",
    answer:
      "Your homepage and a few pages it links to: about, pricing, docs and the like. Jev looks for what you do, who it's for, what it costs and any proof that it works.",
  },
  {
    id: "pay-more",
    question: "Can I pay more to rank higher?",
    answer: `No. ${price} buys a verdict, not a result. You can't buy #1. You can only buy Jev's attention.`,
  },
  {
    id: "score-down",
    question: "Can my rank go down on a rejudge?",
    answer: "Yes. Every rejudge reads your site from scratch, and the newest verdict stands even when it's worse. That's the point.",
  },
  {
    id: "who-can-rejudge",
    question: "Who can rejudge a business?",
    answer: `Whoever added it. They get a Rejudge button on their listing, and every rejudge costs the same ${price}.`,
  },
  {
    id: "public",
    question: "Is my verdict public?",
    answer: "Yes. Every business on the board has a public verdict, a share link and a share card. That's the whole idea.",
  },
  {
    id: "cant-reach",
    question: "What if Jev can't reach my site?",
    answer: "That isn't a verdict. Nothing lands on the board and your retry is free.",
  },
  {
    id: "trick-jev",
    question: "Can I trick Jev with hidden instructions?",
    answer:
      "You can try. Jev reads hidden text too. Sites that try to instruct or bribe an AI judge get a permanent flag on their verdict, and Jev marks them down.",
  },
  {
    id: "declined",
    question: "Why is a site missing from the board?",
    answer: "Jev judges adult, illegal, scam, hateful and parked sites like everyone else, but keeps them off the public board.",
  },
  {
    id: "someone-else",
    question: "Someone added my site. Can I get it removed?",
    answer: `Yes. Email ${CONTACT_EMAIL} and a human will take a look.`,
  },
];

/** schema.org FAQPage for rich results. */
export const faqJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
});
