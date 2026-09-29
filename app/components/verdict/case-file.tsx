import type { Judgment, SubScores } from "~/.server/domain/models";
import { Meter } from "~/components/ui";

const SUBSCORES: ReadonlyArray<readonly [key: keyof SubScores, label: string, hint: string]> = [
  ["clarity", "Clarity", "How fast a stranger gets what this is and who it's for."],
  ["demand", "Real demand", "How real, painful and widespread the problem is."],
  ["originality", "Originality", "How different it is from the obvious alternatives."],
  ["trust", "Trust", "Proof, pricing, real customers, legitimacy."],
  ["wouldJevPay", "Would Jev pay", "Jev's own wallet, if Jev were the customer."],
];

const EXHIBIT_LETTERS = "ABCDEFGHIJ";

const prettyUrl = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "") || url;

/** Everything Jev based the verdict on: sub-scores, pros/cons, reasoning, receipts, crawl log. */
export function CaseFile({ judgment, siteKey }: { judgment: Judgment; siteKey: string }) {
  return (
    <div className="grid gap-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="slab p-5 sm:p-6">
          <h3 className="font-display text-2xl uppercase">Sub-scores</h3>
          <p className="text-sm text-ink-soft">Out of 100. They inform the score; they don't add up to it.</p>
          <div className="mt-5 grid gap-4">
            {SUBSCORES.map(([key, label, hint]) => (
              <div key={key}>
                <Meter label={label} value={judgment.subscores[key]} />
                <p className="mt-1 text-xs text-ink-soft">{hint}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid content-start gap-6">
          <PointsList
            title="What's working"
            mark="✓"
            markClass="bg-up text-[#111110]"
            items={judgment.strengths}
            empty="Jev found nothing to praise. Rough."
          />
          <PointsList
            title="What isn't"
            mark="✗"
            markClass="bg-hot text-[#111110]"
            items={judgment.weaknesses}
            empty="Jev found nothing to complain about. Suspicious."
          />
        </div>
      </div>

      <div className="slab p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl uppercase">Jev's reasoning</h3>
          <p className="font-mono text-[11px] font-bold tracking-widest text-ink-soft uppercase">
            Court transcript · {judgment.model}
          </p>
        </div>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-pretty">{judgment.reasoning}</p>
      </div>

      {judgment.receipts.length > 0 ? (
        <div>
          <h3 className="font-display text-3xl uppercase">Jev's receipts</h3>
          <p className="text-sm text-ink-soft">Quoted verbatim from the crawl and entered into evidence.</p>
          <ol className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {judgment.receipts.map((receipt, index) => (
              <li
                key={index}
                className={`relative border-2 border-line bg-card px-4 pt-7 pb-4 shadow-[4px_4px_0_var(--shadow)] ${
                  index % 2 === 0 ? "-rotate-[0.6deg]" : "rotate-[0.8deg]"
                }`}
              >
                <span className="absolute -top-3.5 left-3 border-2 border-[#111110] bg-jev px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest text-[#111110] uppercase">
                  Exhibit {EXHIBIT_LETTERS[index] ?? index + 1}
                </span>
                <span
                  aria-hidden
                  className="absolute -top-2.5 right-5 h-5 w-16 rotate-[4deg] border border-line/30 bg-jev/50"
                />
                <blockquote className="font-mono text-sm leading-relaxed [overflow-wrap:anywhere]">
                  “{receipt}”
                </blockquote>
                <p className="mt-3 border-t-2 border-dashed border-line/40 pt-2 text-[11px] font-bold tracking-wide text-ink-soft uppercase">
                  Recovered from {siteKey}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {judgment.pagesCrawled.length > 0 ? (
        <details className="group slab-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold uppercase [&::-webkit-details-marker]:hidden">
            <span>
              📄 Pages Jev crawled <span className="tabular">({judgment.pagesCrawled.length})</span>
            </span>
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center border-2 border-line font-mono text-lg leading-none font-bold transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <ol className="grid gap-1.5 border-t-2 border-line px-4 py-3 font-mono text-sm">
            {judgment.pagesCrawled.map((url, index) => (
              <li key={url} className="flex gap-3">
                <span className="tabular text-ink-soft">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]" title={url}>
                  {prettyUrl(url)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function PointsList({
  title,
  mark,
  markClass,
  items,
  empty,
}: {
  title: string;
  mark: string;
  markClass: string;
  items: ReadonlyArray<string>;
  empty: string;
}) {
  return (
    <div className="slab p-5 sm:p-6">
      <h3 className="font-display text-2xl uppercase">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 grid gap-2.5">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-3 text-base font-medium">
              <span
                aria-hidden
                className={`grid size-6 shrink-0 place-items-center border-2 border-[#111110] text-sm font-bold ${markClass}`}
              >
                {mark}
              </span>
              <span className="pt-px">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-ink-soft">{empty}</p>
      )}
    </div>
  );
}
