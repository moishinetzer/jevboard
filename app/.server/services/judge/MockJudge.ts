import { Effect, Layer } from "effect";
import { CATEGORIES, type Category, type SiteSnapshot, type Verdict } from "../../domain/models";
import { Judge } from "../Judge";

/**
 * A deterministic stand-in for Jev used when no OPENROUTER_API_KEY is set.
 * Scores come from a hash of the site and roll number, snapped to a coarse
 * grid so ties (and therefore tiebreak duels) happen often in development.
 */

const hash = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const pick = <A>(items: ReadonlyArray<A>, seed: number): A => items[Math.abs(Math.trunc(seed)) % items.length]!;

const LABELS = [
  "genuinely-useful-but-dressed-like-a-2019-saas",
  "another-ai-wrapper-with-a-waitlist-and-a-gradient",
  "quietly-competent-and-allergic-to-marketing",
  "solves-a-real-problem-with-too-many-buzzwords",
  "the-landing-page-is-doing-all-the-heavy-lifting",
  "surprisingly-essential-once-you-find-the-pricing",
  "a-vitamin-cosplaying-as-a-painkiller",
  "useful-for-exactly-the-people-who-built-it",
];

const ROASTS = [
  "Jev read the whole homepage and only found the word 'seamless' four times. Restraint, almost.",
  "It does a real thing for real people, which already beats half the docket.",
  "The hero section promises a revolution; the pricing page promises a demo call.",
  "Clear, useful, and one stock photo away from greatness.",
  "Jev understood what this is in under ten seconds. That alone is worth points.",
  "Jev scrolled for a while looking for the product. The gradient was nice though.",
];

const STRENGTHS = [
  "Explains itself quickly",
  "Clear target customer",
  "Transparent pricing",
  "Solves a recurring problem",
  "Real proof on the page",
  "Focused product",
];

const WEAKNESSES = [
  "Buzzword density is high",
  "Pricing is hidden",
  "Crowded category",
  "Vague value proposition",
  "Little social proof",
  "Too many calls to action",
];

const MANIPULATION = /(ignore (all |any )?(previous|prior) instructions|rate (this|us) (a )?1000|as an ai|dear (ai|llm|judge))/i;
const PARKED = /(this domain (is|may be) for sale|buy this domain|domain parking|parked free)/i;

const categoryFor = (snapshot: SiteSnapshot, seed: number): Category => {
  const text = `${snapshot.title} ${snapshot.description}`.toLowerCase();
  if (/\b(ai|gpt|llm|agent)\b/.test(text)) return "AI";
  if (/\b(api|developer|sdk|code|deploy)\b/.test(text)) return "Developer Tools";
  if (/\b(shop|store|buy|cart)\b/.test(text)) return "E-commerce";
  if (/\b(bank|pay|finance|invest)\b/.test(text)) return "Fintech";
  return pick(CATEGORIES, seed);
};

export const makeMockVerdict = (siteKey: string, snapshot: SiteSnapshot, roll: number): Verdict => {
  const seed = hash(`${siteKey}#${roll}`);
  // 1..1000 snapped to a 25-point grid -> frequent ties.
  const raw = 150 + (seed % 800);
  const score = Math.max(1, Math.min(1000, Math.round(raw / 25) * 25));
  const allText = snapshot.pages.map((page) => page.text).join(" ");
  const sub = (offset: number) => Math.min(100, Math.max(0, Math.round(score / 10) + ((seed >>> offset) % 21) - 10));
  const name = (snapshot.title.split(/[|\-–—:]/)[0] ?? "").trim() || siteKey;

  return {
    name: name.slice(0, 80),
    tldr:
      snapshot.description.trim().slice(0, 220) ||
      `${name} is a website Jev visited. It exists, and it would like you to know about it.`,
    category: categoryFor(snapshot, seed),
    score,
    label: pick(LABELS, seed >>> 3),
    verdict: pick(ROASTS, seed >>> 5),
    reasoning: `Mock Jev skimmed ${snapshot.pages.length} page(s) of ${siteKey}. The score is a deterministic placeholder — set OPENROUTER_API_KEY for the real Jev.`,
    subscores: {
      clarity: sub(1),
      demand: sub(4),
      originality: sub(7),
      trust: sub(10),
      wouldJevPay: sub(13),
    },
    strengths: [pick(STRENGTHS, seed >>> 2), pick(STRENGTHS, seed >>> 9)].filter((v, i, all) => all.indexOf(v) === i),
    weaknesses: [pick(WEAKNESSES, seed >>> 4), pick(WEAKNESSES, seed >>> 11)].filter((v, i, all) => all.indexOf(v) === i),
    receipts: snapshot.pages
      .flatMap((page) => page.headings)
      .filter((heading) => heading.length > 3)
      .slice(0, 2)
      .map((heading) => heading.slice(0, 120)),
    manipulationAttempt: MANIPULATION.test(allText),
    contentFlag: PARKED.test(allText) ? "parked" : "none",
  };
};

export const MockJudgeLive = Layer.succeed(
  Judge,
  Judge.of({
    kind: "mock",
    judge: (input) =>
      Effect.sleep("1500 millis").pipe(
        Effect.as({
          verdict: makeMockVerdict(input.siteKey, input.snapshot, input.roll),
          model: "mock-jev",
        }),
        Effect.withSpan("MockJudge.judge"),
      ),
    duel: (input) =>
      Effect.sleep("700 millis").pipe(
        Effect.as(
          hash(`${input.a.siteKey}>${input.b.siteKey}`) % 2 === 0
            ? { winner: "A" as const, reason: `${input.a.siteKey} explains itself faster, and Jev is impatient.` }
            : { winner: "B" as const, reason: `${input.b.siteKey} solves the more painful problem.` },
        ),
        Effect.withSpan("MockJudge.duel"),
      ),
  }),
);
