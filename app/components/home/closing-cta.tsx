import { JevFace } from "~/components/logo";
import { formatCount } from "~/lib/format";
import { focusJudgeInput, focusRing } from "./shared";

/** The last billboard before the footer: one more nudge toward the $5 form. */
export function ClosingCta({ judged }: { judged: number }) {
  return (
    <section aria-labelledby="closing-title" className="mx-auto mt-20 max-w-7xl px-4">
      <div className="relative overflow-hidden border-[3px] border-[#111110] bg-hot px-6 py-10 text-white shadow-[8px_8px_0_var(--shadow)] sm:px-10 sm:py-14">
        <JevFace size={220} className="pointer-events-none absolute -right-10 -bottom-12 hidden rotate-12 opacity-95 md:block" />
        <h2 id="closing-title" className="relative max-w-3xl font-display text-5xl leading-[0.95] uppercase sm:text-8xl">
          <span className="block">Paste your site.</span>
          <span className="block">
            Pay $5. <span className="inline-block rotate-[-2deg] bg-[#111110] px-2 text-jev">Pray.</span>
          </span>
        </h2>
        <p className="relative mt-4 max-w-xl text-lg font-bold">
          {judged > 0
            ? `Jev has read ${formatCount(judged)} landing page${judged === 1 ? "" : "s"} so their customers didn't have to. Yours is next.`
            : "Jev hasn't read a single landing page yet. Yours could be the first."}
        </p>
        <a href="#judge" onClick={focusJudgeInput} className={`btn relative mt-8 px-7 py-4 text-xl ${focusRing}`}>
          Get judged — $5
        </a>
      </div>
    </section>
  );
}
