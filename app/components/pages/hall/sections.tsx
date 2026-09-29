import { Link } from "react-router";
import type { BoardEntry, Judgment } from "~/.server/domain/models";
import { Delta, Favicon, Score, TierBadge, VerdictLabel } from "~/components/ui";
import { formatCount, formatMoney, JUDGMENT_PRICE_CENTS, tierFor, timeAgo } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { EmptyNote, focusRing, SiteLink, Stamp } from "../shared";

// ---------------------------------------------------------------------------
// Slim read models (the loader maps service results into these)
// ---------------------------------------------------------------------------

export interface HallEntry {
  readonly siteKey: string;
  readonly name: string;
  readonly score: number;
  readonly rank: number;
  readonly label: string;
  readonly verdict: string;
  readonly rolls: number;
  readonly bestScore: number;
  readonly worstScore: number;
  readonly lastJudgedAt: number;
}

export const toHallEntry = (entry: BoardEntry): HallEntry => ({
  siteKey: entry.siteKey,
  name: entry.name,
  score: entry.score,
  rank: entry.rank,
  label: entry.label,
  verdict: entry.verdict,
  rolls: entry.rolls,
  bestScore: entry.bestScore,
  worstScore: entry.worstScore,
  lastJudgedAt: entry.lastJudgedAt,
});

export interface Swing {
  readonly siteKey: string;
  readonly score: number;
  readonly previousScore: number;
  readonly roll: number;
  readonly label: string;
  readonly createdAt: number;
}

export const toSwing = (judgment: Judgment & { readonly siteKey: string }): Swing => ({
  siteKey: judgment.siteKey,
  score: judgment.score,
  previousScore: judgment.previousScore ?? judgment.score,
  roll: judgment.roll,
  label: judgment.label,
  createdAt: judgment.createdAt,
});

export interface Champion {
  readonly siteKey: string;
  readonly name: string;
  readonly wins: number;
  readonly losses: number;
}

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Exhibit B: Hall of Fame (top 10)
// ---------------------------------------------------------------------------

export function HallOfFame({ entries }: { entries: ReadonlyArray<HallEntry> }) {
  if (entries.length === 0) return <EmptyNote>The docket is empty. Be the first defendant.</EmptyNote>;
  return (
    <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {entries.map((entry) => {
        const tier = tierFor(entry.score);
        return (
          <li key={entry.siteKey}>
            <Link
              to={entryPath(entry.siteKey)}
              className={`group slab-sm flex items-center gap-3 p-3 transition-transform hover:-translate-y-0.5 sm:gap-4 sm:p-4 ${focusRing}`}
            >
              <span
                className={`grid size-12 shrink-0 place-items-center border-[3px] border-[#111110] font-display text-2xl leading-none sm:size-14 sm:text-3xl ${
                  entry.rank === 1 ? "-rotate-3" : ""
                }`}
                style={{ background: tier.color, color: tier.ink }}
              >
                {entry.rank}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <Favicon host={entry.siteKey.split("/")[0]!} size={20} />
                  <span className="truncate font-bold group-hover:underline">{entry.siteKey}</span>
                </span>
                <VerdictLabel label={entry.label} className="max-w-full self-start truncate" />
              </span>
              <span className="shrink-0 text-right">
                <Score score={entry.score} size="text-3xl sm:text-4xl" />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Exhibit C: Wall of Shame (Jev's lowest)
// ---------------------------------------------------------------------------

export function WallOfShame({ entries }: { entries: ReadonlyArray<HallEntry> }) {
  if (entries.length === 0) return <EmptyNote>Nobody has hit rock bottom yet. Give it time.</EmptyNote>;
  return (
    <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry, index) => (
        <li key={entry.siteKey} className="relative">
          <Link
            to={entryPath(entry.siteKey)}
            className={`group slab flex h-full flex-col gap-3 p-5 transition-transform hover:-translate-y-0.5 ${focusRing}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <Favicon host={entry.siteKey.split("/")[0]!} size={24} />
                <span className="truncate font-bold group-hover:underline">{entry.siteKey}</span>
              </span>
              {index === 0 ? <Stamp>Rock bottom</Stamp> : <Stamp>Shame</Stamp>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Score score={entry.score} size="text-5xl" />
              <TierBadge score={entry.score} />
            </div>
            <p className="line-clamp-3 text-sm text-ink-soft">“{entry.verdict}”</p>
            <p className="mt-auto flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-ink-soft">
              <span>
                #{formatCount(entry.rank)} · {plural(entry.rolls, "judgment")}
              </span>
              {entry.bestScore > entry.score ? <span>once {entry.bestScore}</span> : null}
            </p>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Exhibit D: glow-ups & faceplants (reroll deltas)
// ---------------------------------------------------------------------------

/** 1–1000 track with the move from the old score to the new one. */
function ScoreShift({ from, to }: { from: number; to: number }) {
  const up = to >= from;
  const left = (Math.min(from, to) / 1000) * 100;
  const width = Math.max(1, (Math.abs(to - from) / 1000) * 100);
  return (
    <div className="relative h-3 border-2 border-line bg-paper" aria-hidden>
      <div className={`absolute inset-y-0 ${up ? "bg-up" : "bg-down"}`} style={{ left: `${left}%`, width: `${width}%` }} />
      <div className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `calc(${(to / 1000) * 100}% - 1px)` }} />
    </div>
  );
}

export function SwingList({ swings, direction, now }: { swings: ReadonlyArray<Swing>; direction: "up" | "down"; now: number }) {
  const up = direction === "up";
  return (
    <div className="slab p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-3xl uppercase">{up ? "Biggest glow-ups" : "Biggest faceplants"}</h3>
        <span className="text-3xl" aria-hidden>
          {up ? "📈" : "📉"}
        </span>
      </div>
      <p className="text-sm text-ink-soft">
        {up ? "Paid $5, demanded a retrial, got respect." : "Paid $5, demanded a retrial, regretted it. The newest verdict stands."}
      </p>
      {swings.length === 0 ? (
        <div className="mt-4">
          <EmptyNote>{up ? "No retrial has gone up yet." : "No retrial has backfired yet. Yet."}</EmptyNote>
        </div>
      ) : (
        <ol className="mt-4 flex flex-col gap-4">
          {swings.map((swing) => (
            <li key={`${swing.siteKey}-${swing.roll}`} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <SiteLink siteKey={swing.siteKey} size={20} className="min-w-0 max-w-full text-sm" />
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-sm font-bold">
                    {swing.previousScore} → {swing.score}
                  </span>
                  <Delta delta={swing.score - swing.previousScore} />
                </span>
              </div>
              <ScoreShift from={swing.previousScore} to={swing.score} />
              <p className="font-mono text-[11px] text-ink-soft" suppressHydrationWarning>
                Retrial #{swing.roll - 1} · {timeAgo(swing.createdAt, now)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exhibit E: most persistent defendants
// ---------------------------------------------------------------------------

/** Worst..best range on 1–1000 with the current score marked. */
function SpreadBar({ worst, best, current }: { worst: number; best: number; current: number }) {
  return (
    <div className="relative h-3 min-w-24 border-2 border-line bg-paper" aria-hidden>
      <div
        className="absolute inset-y-0 bg-jev"
        style={{ left: `${(worst / 1000) * 100}%`, width: `${Math.max(1, ((best - worst) / 1000) * 100)}%` }}
      />
      <div className="absolute -inset-y-1 w-1 bg-hot" style={{ left: `calc(${(current / 1000) * 100}% - 2px)` }} />
    </div>
  );
}

export function PersistentDefendants({ entries }: { entries: ReadonlyArray<HallEntry> }) {
  if (entries.length === 0) {
    return <EmptyNote>Nobody has demanded a retrial yet. Everyone is suspiciously happy with their verdict.</EmptyNote>;
  }
  return (
    <div className="slab overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">Sites with the most judgments, the money spent and their score spread</caption>
        <thead className="border-b-[3px] border-line bg-paper-2 text-xs uppercase tracking-wide">
          <tr>
            <th scope="col" className="px-4 py-2">Defendant</th>
            <th scope="col" className="px-3 py-2 text-right">Trials</th>
            <th scope="col" className="px-3 py-2 text-right">Fed to Jev</th>
            <th scope="col" className="w-48 px-3 py-2">Worst → best (● now)</th>
            <th scope="col" className="px-4 py-2 text-right">Now</th>
          </tr>
        </thead>
        <tbody className="divide-y-2 divide-line/15">
          {entries.map((entry) => (
            <tr key={entry.siteKey}>
              <td className="max-w-56 px-4 py-3">
                <SiteLink siteKey={entry.siteKey} size={20} className="max-w-full" />
              </td>
              <td className="tabular px-3 py-3 text-right font-bold">🎲 {entry.rolls}</td>
              <td className="tabular px-3 py-3 text-right font-bold">{formatMoney(entry.rolls * JUDGMENT_PRICE_CENTS)}</td>
              <td className="px-3 py-3">
                <SpreadBar worst={entry.worstScore} best={entry.bestScore} current={entry.score} />
                <span className="tabular mt-1 block text-[11px] text-ink-soft">
                  {entry.worstScore}–{entry.bestScore}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Score score={entry.score} size="text-2xl" suffix={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exhibit F: caught bribing Jev
// ---------------------------------------------------------------------------

export function Bribers({ entries, now }: { entries: ReadonlyArray<HallEntry>; now: number }) {
  if (entries.length === 0) {
    return <EmptyNote>Nobody has tried to bribe Jev yet. Jev is almost disappointed.</EmptyNote>;
  }
  return (
    <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.siteKey}>
          <Link
            to={entryPath(entry.siteKey)}
            className={`group relative flex h-full flex-col gap-3 border-[3px] border-hot bg-card p-5 shadow-[6px_6px_0_var(--hot)] transition-transform hover:-translate-y-0.5 ${focusRing}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <Favicon host={entry.siteKey.split("/")[0]!} size={24} />
                <span className="truncate font-bold group-hover:underline">{entry.siteKey}</span>
              </span>
              <Stamp>🚨 Caught</Stamp>
            </div>
            <p className="text-sm">
              Hid instructions for Jev in its website. Jev read them, noted them, and judged the site anyway.
            </p>
            <p className="line-clamp-2 text-sm text-ink-soft">“{entry.verdict}”</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              <Score score={entry.score} size="text-3xl" />
              <span className="font-mono text-xs text-ink-soft" suppressHydrationWarning>
                Last judged {timeAgo(entry.lastJudgedAt, now)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Exhibit G: Duel Pit champions
// ---------------------------------------------------------------------------

export function DuelChampions({ champions }: { champions: ReadonlyArray<Champion> }) {
  if (champions.length === 0) {
    return <EmptyNote>No exact-score ties yet, so the Duel Pit is quiet. Suspiciously quiet.</EmptyNote>;
  }
  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {champions.map((champion, index) => {
        const fights = champion.wins + champion.losses;
        const rate = fights > 0 ? Math.round((champion.wins / fights) * 100) : 0;
        return (
          <li key={champion.siteKey} className="slab-sm flex items-center gap-3 p-3 sm:p-4">
            <span className="w-8 shrink-0 text-center font-display text-3xl leading-none">{index === 0 ? "⚔️" : index + 1}</span>
            <div className="min-w-0 flex-1">
              <SiteLink siteKey={champion.siteKey} size={20} className="max-w-full" />
              <div className="mt-2 flex h-3 border-2 border-line" role="img" aria-label={`${champion.wins} wins, ${champion.losses} losses`}>
                <div className="h-full bg-up" style={{ width: `${rate}%` }} />
                <div className="h-full flex-1 bg-down" />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="tabular text-lg font-bold leading-none">
                {champion.wins}W<span className="text-ink-soft"> – </span>
                {champion.losses}L
              </p>
              <p className="tabular mt-1 text-[11px] text-ink-soft">{rate}% wins</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
