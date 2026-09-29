import { Link } from "react-router";
import { focusRing } from "./shared";

const OBJECTIONS = [
  {
    q: "Can I pay more to rank higher?",
    a: "No. $5 buys a judgment, not a result. You can demand as many retrials as you like, but each one is judged from scratch, and the newest verdict is final.",
  },
  { q: "Can my score go down on a retrial?", a: "Yes. Jev doesn't remember you, probably." },
  {
    q: "What happens on a tie?",
    a: "Jev puts both sites in the Duel Pit and picks a winner. No draws. It repeats until everyone has a unique place.",
  },
  {
    q: "Can I trick Jev with hidden instructions?",
    a: "You can try. Jev keeps a Hall of Shame, and the 🚨 stamp is permanent.",
  },
  {
    q: "Is this gambling?",
    a: "No. $5 buys an AI evaluation of your website. There are no prizes and no payouts — only Jev's opinion, which is priceless (and costs $5).",
  },
] as const;

/** A few objections, overruled. Native <details>, so it's zero JS. */
export function FaqTeaser() {
  return (
    <section aria-labelledby="faq-title" className="flex flex-col">
      <p className="font-mono text-xs font-bold tracking-widest text-hot uppercase">Objections</p>
      <h2 id="faq-title" className="mt-1 font-display text-4xl uppercase sm:text-5xl">
        Overruled.
      </h2>
      <div className="mt-5 flex flex-col gap-3">
        {OBJECTIONS.map((item) => (
          <details key={item.q} className="group slab-sm open:bg-jev/15">
            <summary
              className={`flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold [&::-webkit-details-marker]:hidden ${focusRing} focus-visible:-outline-offset-4`}
            >
              {item.q}
              <span
                className="grid size-7 shrink-0 place-items-center border-2 border-line font-mono text-lg leading-none font-bold transition-transform group-open:rotate-45"
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="px-4 pb-4 text-sm">{item.a}</p>
          </details>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/faq" className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}>
          Read the full FAQ →
        </Link>
        <Link to="/hall" className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}>
          Hall of Fame &amp; Shame →
        </Link>
      </div>
    </section>
  );
}
