import { Link } from "react-router";
import { useLive, useNow } from "~/components/live";
import { Favicon, Score, TierBadge, VerdictLabel } from "~/components/ui";
import { formatCount, formatDuration } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { ShareLinks } from "./share-links";
import { type BoardRowEntry, focusRing, ON_JEV } from "./shared";

const PLACES = [
  { medal: "👑", place: "1st", step: "md:h-32", order: "md:order-2" },
  { medal: "🥈", place: "2nd", step: "md:h-20", order: "md:order-1" },
  { medal: "🥉", place: "3rd", step: "md:h-12", order: "md:order-3" },
] as const;

/** The stage is near-black in both themes (`--shadow` is #111110 / #000). */
const CREAM = "#fbf6e7";

/** The top three as billboard cards on actual podium steps (2 · 1 · 3 on wide screens). */
export function Podium({ entries, total, origin }: { entries: ReadonlyArray<BoardRowEntry>; total: number; origin: string }) {
  if (entries.length === 0) return null;
  const shareText = [
    "The Jevboard podium right now:",
    ...entries.map((entry, index) => `${PLACES[index]!.medal} ${entry.siteKey} (${entry.score}/1000)`),
    "You can't buy #1. You can only buy Jev's attention.",
  ].join("\n");

  return (
    <section aria-labelledby="podium-title" className="border-b-[3px] border-line bg-[var(--shadow)] text-[#fbf6e7]">
      <div className="mx-auto max-w-7xl px-4 pt-10 pb-0 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold tracking-widest text-jev uppercase">
              Top of the docket · all-time · {formatCount(total)} judged
            </p>
            <h2 id="podium-title" className="mt-1 font-display text-5xl uppercase sm:text-7xl">
              The Podium
            </h2>
          </div>
          <ShareLinks text={shareText} url={`${origin}/`} label="Share the podium" tone="dark" />
        </div>

        <ol className="mt-14 grid items-end gap-8 md:mt-12 md:grid-cols-3 md:gap-5">
          {entries.map((entry, index) => (
            <li key={entry.siteKey} className={`flex flex-col ${PLACES[index]!.order}`}>
              <PodiumCard entry={entry} place={index} above={entries[index - 1]} below={entries[index + 1]} />
              <div
                className={`hidden items-start justify-center border-x-[3px] border-t-[3px] pt-2 font-display text-3xl uppercase md:flex ${PLACES[index]!.step}`}
                style={{ borderColor: `${CREAM}cc`, background: `${CREAM}1a`, color: `${CREAM}cc` }}
                aria-hidden
              >
                {PLACES[index]!.place}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PodiumCard({
  entry,
  place,
  above,
  below,
}: {
  entry: BoardRowEntry;
  place: number;
  above: BoardRowEntry | undefined;
  below: BoardRowEntry | undefined;
}) {
  const champion = place === 0;
  const lead = champion && below ? entry.score - below.score : null;
  // Exact-score ties are ordered by Jev's head-to-head duels.
  const tiedWith = !champion ? [above, below].find((other) => other?.score === entry.score) : undefined;

  return (
    <Link
      to={entryPath(entry.siteKey)}
      className={`group relative mb-4 block border-[3px] p-5 text-left transition-transform hover:-translate-y-1 md:mb-5 ${
        champion
          ? "border-[#111110] shadow-[8px_8px_0_var(--hot)] sm:p-6"
          : "border-line bg-card text-ink shadow-[6px_6px_0_var(--jev)]"
      } ${focusRing}`}
      style={champion ? ON_JEV : undefined}
    >
      {champion ? (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 animate-wiggle text-6xl drop-shadow-[3px_3px_0_#111110]" aria-hidden>
          👑
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <span
          className={`-rotate-3 border-[3px] border-[#111110] px-2.5 font-display leading-tight ${
            champion ? "bg-[#111110] text-5xl text-jev" : "bg-jev text-4xl text-[#111110]"
          }`}
        >
          #{entry.rank}
        </span>
        <TierBadge score={entry.score} />
      </div>

      <div className="mt-5 flex min-w-0 items-center gap-3">
        <Favicon host={entry.host} size={champion ? 52 : 44} />
        <div className="min-w-0">
          <h3 className="truncate text-xl leading-tight font-bold group-hover:underline sm:text-2xl">{entry.name}</h3>
          <p className="truncate font-mono text-xs text-ink-soft">{entry.siteKey}</p>
        </div>
      </div>

      <div className="mt-4">
        <Score score={entry.score} size={champion ? "text-8xl sm:text-9xl" : "text-7xl sm:text-8xl"} />
      </div>

      <VerdictLabel label={entry.label} className="mt-3 max-w-full break-words" />
      <p className="mt-3 line-clamp-3 text-sm">{entry.tldr}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-dashed border-line pt-3 font-mono text-xs font-bold">
        {champion ? <Reign siteKey={entry.siteKey} /> : null}
        {lead !== null ? (
          <span>{lead > 0 ? `+${lead} pts clear of #2` : "⚔️ Tied with #2 — won the Duel Pit"}</span>
        ) : null}
        {tiedWith ? (
          <span>
            ⚔️ Tied with #{tiedWith.rank} — {tiedWith.rank > entry.rank ? "won" : "lost"} the Duel Pit
          </span>
        ) : null}
        {entry.rolls > 1 ? <span>🎲 ×{entry.rolls}</span> : null}
        <span>Jev sent {formatCount(entry.clicks)} visitors</span>
      </div>
    </Link>
  );
}

/** "Reigning for 2d 4h", from the live counters (which know when the reign started). */
function Reign({ siteKey }: { siteKey: string }) {
  const { counters, now: serverNow } = useLive();
  const now = useNow(30_000, serverNow);
  if (!counters.king || counters.king.siteKey !== siteKey) return null;
  return (
    <span className="bg-[#111110] px-1.5 py-0.5 text-jev" suppressHydrationWarning>
      Reigning for {formatDuration(now - counters.king.since)}
    </span>
  );
}
