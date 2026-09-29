import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { ContentFlag } from "~/.server/domain/models";
import type { JudgingView } from "~/.server/flows/judging";
import { JudgeForm } from "~/components/judge-form";
import { JevFace } from "~/components/logo";
import { Favicon, TierBadge, VerdictLabel } from "~/components/ui";
import { formatCount, formatDelta } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { Section } from "./controls";
import { DuelCard, duelRecord, rivalSiteKey } from "./duel-card";
import { serialLabel } from "./links";
import { isHighScore, type ShareFacts } from "./share-copy";
import { SharePanel } from "./share-panel";
import { RoastBubble } from "./verdict-card";
import "./verdict.css";

type Result = NonNullable<JudgingView["result"]>;
type OrderView = JudgingView["order"];

/** Milliseconds: the count-up runs COUNT_DELAY → COUNT_DELAY + COUNT_DURATION, then the rest lands. */
const COUNT_DELAY = 300;
const COUNT_DURATION = 1800;
const LANDED = COUNT_DELAY + COUNT_DURATION;

const delay = (ms: number): CSSProperties => ({ "--jev-delay": `${ms}ms` }) as CSSProperties;

/** Counts from 0 to `value` in CSS (no JS), then holds. Screen readers get the number straight away. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const style = {
    "--jev-count": value,
    "--jev-count-delay": `${COUNT_DELAY}ms`,
    "--jev-count-duration": `${COUNT_DURATION}ms`,
    minWidth: `${String(value).length}ch`,
  } as CSSProperties;
  return (
    <span className={className}>
      <span aria-hidden className="jev-count inline-block text-right" style={style} />
      <span className="sr-only">{value}</span>
    </span>
  );
}

const CONFETTI_COLORS = ["var(--jev)", "var(--hot)", "#7cf0c5", "#9ec5ff", "#d6c8ff", "#fffdf6", "#ff9f1c"];

/** A deterministic burst of paper confetti, fired when the count lands. */
export function Confetti({
  pieces = 64,
  origin = { x: "50%", y: "40%" },
}: {
  pieces?: number;
  origin?: { x: string; y: string };
}) {
  return (
    <div aria-hidden className="jev-confetti" style={{ "--ox": origin.x, "--oy": origin.y } as CSSProperties}>
      {Array.from({ length: pieces }, (_, index) => {
        const angle = (index / pieces) * Math.PI * 2 + (index % 3) * 0.4;
        const distance = 120 + ((index * 53) % 170);
        const style = {
          "--x": `${Math.round(Math.cos(angle) * distance * 1.7)}px`,
          "--y": `${Math.round(Math.sin(angle) * distance - 70)}px`,
          "--r": `${((index * 97) % 720) - 360}deg`,
          "--c": CONFETTI_COLORS[index % CONFETTI_COLORS.length],
          "--d": `${LANDED - 150 + (index % 6) * 35}ms`,
        } as CSSProperties;
        return <i key={index} style={style} />;
      })}
    </div>
  );
}

const FLAG_COPY: Record<ContentFlag, string> = {
  parked:
    "It looks parked, for sale or still under construction — there's no business here for Jev to judge yet. When there is, come back.",
  adult: "It looks like adult content, which Jev keeps off the public board.",
  illegal: "Something on it looked like it might break the law, so Jev is keeping it off the board.",
  scam: "Parts of it looked like a scam to Jev. Jev might be wrong — but the public board is no place to find out.",
  hateful: "Jev found content that targets people, and that stays off the board.",
  none: "Jev decided not to list it on the public board.",
};

/** Jev judged the site but won't put it on the public board. */
function Declined({ order, result }: { order: OrderView; result: Result }) {
  const flag = result.judgment.contentFlag;
  return (
    <section aria-labelledby="declined-title" className="slab p-5 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <JevFace size={84} className="shrink-0" />
        <div className="min-w-0">
          <span className="sticker text-sm">Case dismissed · Judgment {serialLabel(result.judgment.serial)}</span>
          <h2
            id="declined-title"
            className="mt-3 font-display text-4xl leading-none uppercase [overflow-wrap:anywhere] sm:text-6xl"
          >
            Jev declined to list {order.siteKey}.
          </h2>
          <p className="mt-4 max-w-xl text-lg">{FLAG_COPY[flag]}</p>
          <p className="mt-3 max-w-xl text-sm text-ink-soft">
            It won't appear on the board, the Tape or the Hall. No hard feelings — Jev reviews websites, not people.
          </p>
          {flag === "parked" ? (
            <div className="mt-6">
              <p className="mb-3 font-bold">Launched something real since?</p>
              <JudgeForm siteUrl={order.url} size="md" />
            </div>
          ) : null}
          <Link to="/" className="btn btn-ghost mt-6 px-5 py-3">
            Back to the board
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The payoff: count-up score, rank, label, roast, duels, then share and retrial. */
export function VerdictReveal({ order, result, origin }: { order: OrderView; result: Result; origin: string }) {
  const { judgment, entry, duels, totalEntries } = result;
  if (!entry) return <Declined order={order} result={result} />;

  const high = isHighScore(judgment.score);
  const delta = judgment.previousScore === null ? null : judgment.score - judgment.previousScore;
  const url = `${origin}${entryPath(entry.siteKey)}`;
  const record = duelRecord(duels, entry.id);
  const lastWin = duels.findLast((duel) => duel.winnerId === entry.id);
  const facts: ShareFacts = {
    siteKey: entry.siteKey,
    score: judgment.score,
    rank: entry.rank,
    total: totalEntries,
    label: judgment.label,
    url,
    rolls: judgment.roll,
    previousScore: judgment.previousScore,
    duelWonAgainst: lastWin ? rivalSiteKey(lastWin, entry.id) : null,
  };
  const serial = serialLabel(judgment.serial);

  return (
    <div className="grid gap-14">
      <section aria-labelledby="reveal-title" className="slab relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-[3px] border-line bg-ink px-4 py-2 font-mono text-[11px] font-bold tracking-widest text-paper uppercase sm:px-6">
          <span>⚖️ Jev has reached a verdict</span>
          <span>
            Judgment {serial} · {order.kind === "reroll" ? `Retrial (roll ${judgment.roll})` : "First judgment"}
          </span>
        </div>

        <div className="relative grid gap-6 p-5 sm:p-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-10">
          {high ? <Confetti origin={{ x: "22%", y: "45%" }} /> : null}
          <div className="relative border-[3px] border-[#111110] bg-jev px-6 py-5 text-center text-[#111110] shadow-[6px_6px_0_var(--shadow)]">
            <p className="font-mono text-[11px] font-bold tracking-widest uppercase">Jev's score</p>
            <p className="mt-1">
              <CountUp value={judgment.score} className="score-num text-[8.5rem] sm:text-[11rem]" />
            </p>
            <p className="mt-1 font-mono text-lg font-bold">/1000</p>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Favicon host={entry.host} size={36} />
              <h2
                id="reveal-title"
                className="font-display text-4xl leading-none uppercase [overflow-wrap:anywhere] sm:text-5xl"
              >
                {judgment.name}
              </h2>
            </div>
            <p className="jev-rise mt-4 text-xl leading-tight font-bold sm:text-2xl" style={delay(LANDED - 400)}>
              {delta !== null ? (
                <>
                  <span className="tabular">
                    {judgment.previousScore} → {judgment.score}
                  </span>
                  ,{" "}
                  <span className={`tabular ${delta > 0 ? "text-up" : delta < 0 ? "text-down" : ""}`}>
                    {formatDelta(delta)}
                  </span>
                  , now <span className="highlight">#{entry.rank}</span> of {formatCount(totalEntries)}
                </>
              ) : (
                <>
                  Enters the board at <span className="highlight">#{entry.rank}</span> of {formatCount(totalEntries)}
                </>
              )}
            </p>
            <div className="jev-rise mt-4 flex flex-wrap items-center gap-2" style={delay(LANDED - 200)}>
              <TierBadge score={judgment.score} />
              <VerdictLabel label={judgment.label} className="text-sm!" />
              {entry.rank === 1 ? <span className="sticker">👑 New #1</span> : null}
              {judgment.manipulationAttempt ? (
                <span className="sticker bg-hot!">🚨 Caught trying to bribe Jev</span>
              ) : null}
            </div>
            {high ? (
              <p className="jev-rise mt-5 font-display text-2xl uppercase sm:text-3xl" style={delay(LANDED)}>
                Jev is impressed. Jev is never impressed.
              </p>
            ) : (
              <div
                className="jev-stamp mt-6 inline-block border-4 border-double border-line px-4 py-2"
                style={delay(LANDED)}
              >
                <p className="font-display text-3xl leading-none uppercase sm:text-4xl">Jev has spoken.</p>
                <p className="mt-1 font-mono text-[11px] font-bold tracking-widest uppercase">
                  You may appeal. Jev may not care.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="jev-rise grid gap-7 border-t-[3px] border-line p-5 sm:p-8" style={delay(LANDED + 200)}>
          <RoastBubble verdict={judgment.verdict} />
          <div className="border-l-[6px] border-jev pl-4">
            <p className="font-mono text-[11px] font-bold tracking-widest uppercase">TL;DR</p>
            <p className="mt-1 text-lg leading-snug text-pretty">{judgment.tldr}</p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <Link to={entryPath(entry.siteKey)} className="btn px-5 py-3.5 text-lg">
              See your verdict page →
            </Link>
            <a href="#share" className="btn btn-ghost px-5 py-3.5 text-lg">
              Share it
            </a>
            <JudgeForm siteUrl={entry.url} />
          </div>
        </div>
      </section>

      {duels.length > 0 ? (
        <Section
          id="duels"
          kicker={`Tied at ${judgment.score}`}
          title="Duels fought"
          meta={
            <span className="tabular">
              {record.wins}W – {record.losses}L
            </span>
          }
        >
          <ul className="grid gap-5 sm:grid-cols-2">
            {duels.map((duel) => (
              <li key={duel.id} className="flex">
                <DuelCard duel={duel} perspectiveId={entry.id} now={judgment.createdAt} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="share" kicker={high ? "Brag responsibly" : "Confess publicly"} title="Tell everyone">
        <div className="max-w-2xl">
          <SharePanel facts={facts} name={entry.name} serial={serial} />
        </div>
      </Section>
    </div>
  );
}
