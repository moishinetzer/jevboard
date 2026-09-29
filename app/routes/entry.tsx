import { Effect } from "effect";
import { isRouteErrorResponse, Link, useFetcher, useParams } from "react-router";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { JudgeForm } from "~/components/judge-form";
import { JevFace } from "~/components/logo";
import { BadgeEmbed } from "~/components/verdict/badge-embed";
import { CaseFile } from "~/components/verdict/case-file";
import { Section } from "~/components/verdict/controls";
import { duelRecord, DuelPit } from "~/components/verdict/duel-card";
import { ogPath, serialLabel } from "~/components/verdict/links";
import { RetrialBox } from "~/components/verdict/roll-history";
import type { ShareFacts } from "~/components/verdict/share-copy";
import { SharePanel } from "~/components/verdict/share-panel";
import { Neighbours, WhereItStands } from "~/components/verdict/standing";
import { percentileLine, VerdictHero } from "~/components/verdict/verdict-card";
import { formatMoney, JUDGMENT_PRICE_CENTS } from "~/lib/format";
import { entryPath, normalizeSite } from "~/lib/site-key";
import type { Route } from "./+types/entry";

const siteKeyFromParams = (splat: string | undefined): string =>
  decodeURIComponent(splat ?? "")
    .toLowerCase()
    .replace(/\/+$/, "");

export const loader = effectLoader("entry", ({ params }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const board = yield* Board;
    const siteKey = siteKeyFromParams(params["*"]);
    const entry = yield* board.getBySiteKey(siteKey);
    const judgments = yield* board.judgments(entry.id);
    const duels = yield* board.duelsForEntry(entry.id, 30);
    const neighbours = yield* board.neighbours(entry.id, 2);
    const stats = yield* board.stats;
    const percentile = stats.entries > 1 ? Math.round(((stats.entries - entry.rank) / (stats.entries - 1)) * 100) : 100;
    const { origin } = yield* CurrentRequest;
    return {
      entry,
      judgments,
      duels,
      neighbours,
      histogram: stats.histogram,
      totalEntries: stats.entries,
      percentile,
      origin,
      now: Date.now(),
    };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: "Not on the docket — Jevboard" }, { name: "robots", content: "noindex" }];
  const { entry, origin } = loaderData;
  const url = `${origin}${entryPath(entry.siteKey)}`;
  const image = `${origin}${ogPath(entry.siteKey)}`;
  const title = `${entry.siteKey} — ${entry.score}/1000 on Jevboard`;
  const description = `Jev's verdict: “${entry.label}”. ${entry.tldr}`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:site_name", content: "Jevboard" },
    { property: "og:type", content: "article" },
    { property: "og:url", content: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${entry.siteKey} scored ${entry.score}/1000 (#${entry.rank}) on Jevboard` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "theme-color", content: "#ffd400" },
  ];
};

export default function Entry({ loaderData }: Route.ComponentProps) {
  const { entry, judgments, duels, neighbours, histogram, totalEntries, percentile, origin, now } = loaderData;
  const latest = judgments[0];
  const serial = latest ? serialLabel(latest.serial) : "";
  const record = duelRecord(duels, entry.id);
  const facts: ShareFacts = {
    siteKey: entry.siteKey,
    score: entry.score,
    rank: entry.rank,
    total: totalEntries,
    label: entry.label,
    url: `${origin}${entryPath(entry.siteKey)}`,
    rolls: entry.rolls,
    previousScore: latest?.previousScore ?? null,
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 font-mono text-xs font-bold tracking-wide uppercase">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <li>
            <Link to="/" className="hover:underline">
              ← The board
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to={`/?category=${encodeURIComponent(entry.category)}`} className="hover:underline">
              {entry.category}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-ink-soft [overflow-wrap:anywhere]">
            {entry.siteKey}
          </li>
        </ol>
      </nav>

      <VerdictHero
        entry={entry}
        judgment={latest}
        totalEntries={totalEntries}
        percentile={percentile}
        now={now}
        share={facts}
      />

      <div className="mt-16 grid gap-16 sm:mt-20 sm:gap-20">
        {latest ? (
          <Section id="case-file" kicker={`Judgment ${serial} · evidence`} title="The case file">
            <CaseFile judgment={latest} siteKey={entry.siteKey} />
          </Section>
        ) : null}

        <Section id="share" kicker="Brag or confess" title="Spread the verdict">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-8">
            <div className="min-w-0">
              <h3 className="mb-4 font-display text-2xl uppercase">Share it</h3>
              <SharePanel facts={facts} name={entry.name} serial={serial} allowVoiceChoice />
            </div>
            <div className="min-w-0">
              <h3 className="mb-4 font-display text-2xl uppercase">Embed your badge</h3>
              <BadgeEmbed
                siteKey={entry.siteKey}
                score={entry.score}
                rank={entry.rank}
                total={totalEntries}
                label={entry.label}
                origin={origin}
              />
            </div>
          </div>
        </Section>

        <Section
          id="retrial"
          kicker="$5 · the newest verdict stands"
          title="Demand a retrial"
          meta={
            <span>
              {entry.rolls} roll{entry.rolls === 1 ? "" : "s"} · {formatMoney(entry.rolls * JUDGMENT_PRICE_CENTS)} fed
              to Jev
            </span>
          }
        >
          <RetrialBox entry={entry} judgments={judgments} now={now} />
        </Section>

        <Section
          id="duel-pit"
          kicker="Exact-score tiebreaks"
          title="The Duel Pit"
          meta={
            duels.length > 0 ? (
              <span className="inline-flex items-center gap-2">
                Record
                <span className="tabular border-2 border-line bg-card px-2 py-0.5 text-base">
                  {record.wins}W – {record.losses}L
                </span>
              </span>
            ) : null
          }
        >
          <DuelPit duels={duels} entryId={entry.id} score={entry.score} now={now} />
        </Section>

        <Section id="standing" kicker={`#${entry.rank} of ${totalEntries}`} title="Where it stands">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-3 font-display text-2xl uppercase">Neighbours on the board</h3>
              <Neighbours entry={entry} neighbours={neighbours} />
            </div>
            <div className="min-w-0">
              <h3 className="mb-3 font-display text-2xl uppercase">Every score Jev has handed out</h3>
              <WhereItStands
                score={entry.score}
                histogram={histogram}
                caption={percentileLine(entry.rank, totalEntries, percentile)}
              />
            </div>
          </div>
        </Section>

        <ChallengeRival name={entry.name} />
      </div>
    </main>
  );
}

function ChallengeRival({ name }: { name: string }) {
  return (
    <section
      aria-labelledby="challenge-title"
      className="slab relative overflow-hidden bg-hot! p-6 text-[#111110] sm:p-10"
    >
      <div aria-hidden className="halftone pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold tracking-widest uppercase">Challenge a rival</p>
          <h2
            id="challenge-title"
            className="mt-2 font-display text-5xl leading-[0.92] uppercase [overflow-wrap:anywhere] sm:text-7xl"
          >
            Think you're more useful than {name}?
          </h2>
          <p className="mt-3 text-lg font-bold">Same judge. Same $5. No mercy, no refunds on your ego.</p>
        </div>
        <Link to="/#judge" className="btn shrink-0 self-start px-7 py-4 text-xl lg:self-center">
          Get judged — $5
        </Link>
      </div>
    </section>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const params = useParams();
  const siteKey = siteKeyFromParams(params["*"]);
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  if (!notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <JevFace size={96} className="mx-auto -rotate-12" />
        <h1 className="mt-6 font-display text-5xl uppercase sm:text-7xl">Jev tripped over a cable</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">
          This verdict couldn't be loaded right now. The ruling stands; the page just fell over. Try again in a moment.
        </p>
        <Link to="/" className="btn mt-8 px-5 py-3">
          Back to the board
        </Link>
      </main>
    );
  }

  const normalized = normalizeSite(siteKey);
  const judgeable = normalized.ok ? normalized.site.siteKey : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
      <JevFace size={104} className="mx-auto animate-wiggle" />
      <p className="mt-6 inline-block bg-ink px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-paper uppercase">
        404 · Not on the docket
      </p>
      <h1 className="mt-4 font-display text-5xl leading-[0.92] uppercase [overflow-wrap:anywhere] sm:text-7xl">
        {judgeable ? `Jev hasn't judged ${judgeable} yet.` : "Jev has no record of that."}
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-lg">
        {judgeable ? (
          <>
            Want Jev to judge <span className="font-bold">{judgeable}</span>? $5 gets a crawl, a TL;DR, a score out of
            1000 and a roast you'll either frame or delete.
          </>
        ) : (
          "Maybe it was never judged — or never existed. Paste a site below and find out where it ranks."
        )}
      </p>
      {judgeable ? <JudgeThisSite siteKey={judgeable} /> : null}
      <div className="slab mt-12 p-5 text-left sm:p-6">
        <p className="mb-3 font-display text-2xl uppercase">{judgeable ? "Or judge a different site" : "Get judged"}</p>
        <JudgeForm size="md" />
      </div>
    </main>
  );
}

/** One-click "Get judged — $5" for a site key that isn't on the board yet. */
function JudgeThisSite({ siteKey }: { siteKey: string }) {
  const fetcher = useFetcher<{ ok: false; message: string }>();
  const busy = fetcher.state !== "idle";
  const failure = fetcher.data && fetcher.data.ok === false ? fetcher.data : null;
  return (
    <fetcher.Form method="post" action="/judge" className="mt-8">
      <input type="hidden" name="url" value={siteKey} />
      <button type="submit" disabled={busy} className="btn px-7 py-4 text-xl">
        {busy ? "Checking…" : "Get judged — $5"}
      </button>
      <div aria-live="polite" className="min-h-6">
        {failure ? <p className="mt-3 font-bold">⚠️ {failure.message}</p> : null}
      </div>
    </fetcher.Form>
  );
}
