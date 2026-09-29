import { Histogram } from "~/components/ui";
import { formatCount, SCORE_TIERS } from "~/lib/format";

interface ScoreStats {
  readonly entries: number;
  readonly average: number | null;
  readonly highest: number | null;
  readonly lowest: number | null;
}

/** "Where everyone landed": the score distribution plus the tier ladder that gives 1–1000 meaning. */
export function VerdictSpread({ histogram, stats }: { histogram: ReadonlyArray<number>; stats: ScoreStats }) {
  const tiers = [...SCORE_TIERS].reverse();
  return (
    <section aria-labelledby="spread-title" className="slab flex flex-col p-5 sm:p-6">
      <p className="font-mono text-xs font-bold tracking-widest text-hot uppercase">The receipts</p>
      <h2 id="spread-title" className="mt-1 font-display text-4xl uppercase sm:text-5xl">
        Where everyone landed
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        1,000 points of usefulness. Jev hands them out grudgingly.
      </p>

      {stats.entries > 0 ? (
        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat label="Average" value={stats.average} />
          <Stat label="Highest" value={stats.highest} />
          <Stat label="Lowest" value={stats.lowest} />
        </dl>
      ) : null}

      <div className="mt-6">
        <Histogram buckets={histogram} />
        <p className="sr-only">
          Scores of {formatCount(stats.entries)} defendants, in buckets of 100:{" "}
          {histogram.map((count, index) => `${index * 100 + 1}–${(index + 1) * 100}: ${count}`).join(", ")}.
        </p>
      </div>

      <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Score tiers">
        {tiers.map((tier) => (
          <li
            key={tier.label}
            className="inline-flex items-center gap-1 border-2 border-[#111110] px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{ background: tier.color, color: tier.ink }}
          >
            <span aria-hidden>{tier.emoji}</span>
            {tier.label}
            <span className="tabular opacity-75">{tier.min}+</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="border-2 border-line bg-paper px-2 py-2">
      <dt className="font-mono text-[10px] font-bold tracking-widest text-ink-soft uppercase">{label}</dt>
      <dd className="score-num mt-1 text-4xl">{value ?? "—"}</dd>
    </div>
  );
}
