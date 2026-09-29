import { BribeJev } from "./bribe-jev";
import { focusJudgeInput, focusRing } from "./shared";

const STEPS = [
  {
    title: "Paste",
    emoji: "🔗",
    body: "Drop your URL. That's the whole form. If your website can't explain your business, that is the verdict.",
  },
  {
    title: "Pay $5",
    emoji: "💵",
    body: "Five dollars buys one judgment. Not a rank. Not a prize. Jev's undivided, mildly contemptuous attention.",
  },
  {
    title: "Jev judges",
    emoji: "🧐",
    body: "Jev crawls your homepage and a few pages it links to, writes the TL;DR, and scores usefulness from 1 to 1000.",
  },
  {
    title: "The Duel Pit",
    emoji: "⚔️",
    body: "Tied on the exact same score? Jev doesn't do draws. Head-to-head duels until you find your place.",
  },
] as const;

/** Four steps, the retrial rule, and the "Bribe Jev" easter egg. */
export function HowItWorks({ bribesCaught }: { bribesCaught: number }) {
  return (
    <section aria-labelledby="how-title" className="mt-20 border-y-[3px] border-line bg-paper-2">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
        <p className="font-mono text-xs font-bold tracking-widest text-hot uppercase">Court procedure</p>
        <h2 id="how-title" className="mt-1 font-display text-5xl uppercase sm:text-7xl">
          How the court works
        </h2>
        <p className="mt-2 max-w-xl text-ink-soft">Four steps. No appeals process, except paying again.</p>

        <ol className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="slab relative flex flex-col p-5 pt-7">
              <span
                className="absolute -top-5 left-4 border-[3px] border-[#111110] bg-jev px-2 font-display text-3xl leading-tight text-[#111110]"
                aria-hidden
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="absolute top-3 right-4 text-3xl" aria-hidden>
                {step.emoji}
              </span>
              <h3 className="mt-2 font-display text-3xl uppercase">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 text-sm">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          <div className="slab flex flex-col gap-4 p-5 sm:flex-row sm:items-center lg:col-span-3">
            <span className="text-5xl" aria-hidden>
              🎲
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-3xl uppercase">Demand a retrial — $5</h3>
              <p className="mt-1 text-sm">
                Jev re-reads everything from scratch. Your score can go up. It can also go down.{" "}
                <strong>That's the point.</strong> Paste the same URL again — the newest verdict stands.
              </p>
            </div>
            <a href="#judge" onClick={focusJudgeInput} className={`btn shrink-0 px-4 py-2.5 text-sm ${focusRing}`}>
              Demand a retrial
            </a>
          </div>
          <div className="slab flex flex-col gap-4 p-5 sm:flex-row sm:items-center lg:col-span-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-3xl uppercase">Can I pay more?</h3>
              <p className="mt-1 text-sm">No. You can't buy #1. You can try, though.</p>
            </div>
            <BribeJev bribesCaught={bribesCaught} />
          </div>
        </div>
      </div>
    </section>
  );
}
