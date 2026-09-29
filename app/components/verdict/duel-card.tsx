import { Link } from "react-router";
import type { Duel } from "~/.server/domain/models";
import { Favicon } from "~/components/ui";
import { timeAgo } from "~/lib/format";
import { entryPath } from "~/lib/site-key";

const sides = (duel: Duel, perspectiveId: string) => {
  const challenger = { id: duel.challengerId, siteKey: duel.challengerSiteKey };
  const opponent = { id: duel.opponentId, siteKey: duel.opponentSiteKey };
  return duel.opponentId === perspectiveId ? { us: opponent, them: challenger } : { us: challenger, them: opponent };
};

/** The other side of a duel. */
export const rivalSiteKey = (duel: Duel, perspectiveId: string): string => sides(duel, perspectiveId).them.siteKey;

/** Wins and losses from one site's point of view. */
export const duelRecord = (duels: ReadonlyArray<Duel>, perspectiveId: string) => {
  const wins = duels.filter((duel) => duel.winnerId === perspectiveId).length;
  return { wins, losses: duels.length - wins };
};

/** One Duel Pit bout: both sites, who won, and Jev's one-line ruling. */
export function DuelCard({ duel, perspectiveId, now }: { duel: Duel; perspectiveId: string; now: number }) {
  const { us, them } = sides(duel, perspectiveId);
  const won = duel.winnerId === us.id;
  return (
    <article className="slab-sm flex w-full flex-col overflow-hidden" aria-label={`Duel against ${them.siteKey}: ${won ? "won" : "lost"}`}>
      <header className="flex items-center justify-between gap-2 border-b-2 border-line bg-[#111110] px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest text-[#fbf6e7] uppercase">
        <span>⚔️ Tied at {duel.score}</span>
        <span className={`border-2 border-[#111110] px-1.5 text-[#111110] ${won ? "bg-up" : "bg-hot"}`}>{won ? "Won" : "Lost"}</span>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-4 sm:px-4">
        <Fighter siteKey={us.siteKey} winner={won} />
        <span
          aria-hidden
          className="grid size-11 -rotate-6 place-items-center rounded-full border-[3px] border-line bg-hot font-display text-lg text-white"
        >
          VS
        </span>
        <Fighter siteKey={them.siteKey} winner={!won} link />
      </div>
      <blockquote className="mt-auto border-t-2 border-dashed border-line px-4 py-3 text-sm leading-snug">
        <span className="font-bold">Jev:</span> “{duel.reason}”
      </blockquote>
      <p className="border-t-2 border-line/20 px-4 py-1.5 font-mono text-[10px] font-bold tracking-widest text-ink-soft uppercase">
        <time dateTime={new Date(duel.createdAt).toISOString()}>{timeAgo(duel.createdAt, now)}</time>
      </p>
    </article>
  );
}

function Fighter({ siteKey, winner, link = false }: { siteKey: string; winner: boolean; link?: boolean }) {
  const host = siteKey.split("/")[0] ?? siteKey;
  const name = (
    <span className={`text-sm font-bold [overflow-wrap:anywhere] ${winner ? "" : "line-through decoration-hot decoration-2"}`}>
      {siteKey}
    </span>
  );
  return (
    <div className={`flex min-w-0 flex-col items-center gap-1.5 text-center ${winner ? "" : "opacity-70"}`}>
      <span className="relative">
        <Favicon host={host} size={40} />
        {winner ? (
          <span aria-hidden className="absolute -top-3.5 -right-3 rotate-12 text-lg">
            👑
          </span>
        ) : null}
      </span>
      {link ? (
        <Link to={entryPath(siteKey)} className="hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
      <span className="font-mono text-[10px] font-bold tracking-widest uppercase">{winner ? "Winner" : "Loser"}</span>
    </div>
  );
}

/** The Duel Pit section body for a verdict page. */
export function DuelPit({
  duels,
  entryId,
  score,
  now,
}: {
  duels: ReadonlyArray<Duel>;
  entryId: string;
  score: number;
  now: number;
}) {
  if (duels.length === 0) {
    return (
      <div className="slab-sm flex flex-col items-start gap-2 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
        <span aria-hidden className="text-5xl">
          ⚔️
        </span>
        <p className="text-lg">
          No duels yet. Nobody else has scored exactly <span className="score-num text-2xl">{score}</span>… yet. When
          someone does, Jev settles it here, head to head. <span className="font-bold">No draws.</span>
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {duels.map((duel) => (
        <li key={duel.id} className="flex">
          <DuelCard duel={duel} perspectiveId={entryId} now={now} />
        </li>
      ))}
    </ul>
  );
}
