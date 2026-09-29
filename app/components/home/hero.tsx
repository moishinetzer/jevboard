import { JudgeForm } from "~/components/judge-form";
import { JevBench } from "./jev-bench";
import { LiveCounters } from "./live-counters";
import { MARKER } from "./shared";

/**
 * The billboard: headline, the one-sentence rule, the $5 form and the live
 * momentum counters, with Jev's bench (and the reigning #1) alongside.
 */
export function Hero({ king }: { king: { siteKey: string; name: string; host: string } | null }) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden border-b-[3px] border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 pt-8 pb-12 sm:pt-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6 lg:pb-16">
        <div className="min-w-0 lg:col-span-7 lg:row-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sticker">⚖️ Court is in session</span>
            <span className="sticker bg-card! text-ink! border-line!">1–1000 · no draws · no bribes</span>
          </div>

          <h1
            id="hero-title"
            className="mt-5 font-display text-[clamp(3.6rem,19vw,8rem)] leading-[0.9] tracking-tight uppercase lg:text-[clamp(5.5rem,9.4vw,9rem)]"
          >
            <span className="block">Pay $5.</span>
            <span className="block">Get judged</span>
            <span className="block">
              by{" "}
              <span className="inline-block -rotate-2 border-[3px] border-[#111110] bg-jev px-2 text-[#111110] shadow-[6px_6px_0_var(--hot)]">
                Jev.
              </span>
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-2xl leading-tight font-bold sm:text-3xl">
            You can't buy #1. <span className={MARKER}>You can only buy Jev's attention.</span>
          </p>
          <p className="mt-4 max-w-2xl text-base text-ink-soft sm:text-lg">
            Paste your URL. Jev crawls your site, writes the TL;DR and scores how useful your business is from{" "}
            <strong className="text-ink">1 to 1000</strong>. Ties are settled in the Duel Pit. Don't like the verdict?{" "}
            <strong className="text-ink">$5 buys a retrial</strong> — and the new score stands, even if it's lower.
          </p>

          <div id="judge" className="mt-8 max-w-2xl scroll-mt-40 [&_input]:scroll-mt-40">
            <JudgeForm />
            <p className="mt-1 font-mono text-xs text-ink-soft">
              No pitch deck. No login. If your website can't explain your business, that <em>is</em> the verdict.
            </p>
          </div>
        </div>

        {/* Phone: counters right under the form, then Jev. Desktop: Jev on top of the right column. */}
        <div className="order-3 min-w-0 lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:pt-2">
          <JevBench king={king} />
        </div>
        <LiveCounters className="order-2 self-start lg:order-none lg:col-span-5 lg:col-start-8 lg:row-start-2" />
      </div>
    </section>
  );
}
