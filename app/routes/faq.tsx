import { Effect } from "effect";
import { Link } from "react-router";
import { AppConfig } from "~/.server/config";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { JevFace } from "~/components/logo";
import { FAQ, faqJsonLd } from "~/components/pages/faq/content";
import { FaqList } from "~/components/pages/faq/faq-list";
import { JevBotSection } from "~/components/pages/faq/jevbot";
import { pageMeta } from "~/components/pages/meta";
import { focusRing, PageMasthead } from "~/components/pages/shared";
import type { Route } from "./+types/faq";

export const loader = effectLoader("faq", () =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const { origin } = yield* CurrentRequest;
    return { userAgent: config.crawlUserAgent, origin };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: "FAQ",
    description:
      "Who is Jev, what Jev looks at, why you can't pay for a better score, what happens on a tie, refunds, and how JevBot crawls your site. Answered by Jev, grudgingly.",
    path: "/faq",
    origin: loaderData?.origin,
  });

export default function Faq({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()).replace(/</g, "\\u003c") }}
      />
      <PageMasthead
        kicker="Frequently asked objections"
        title={
          <>
            Jev will take <span className="highlight">questions</span> now
          </>
        }
        aside={<JevFace size={132} className="hidden -rotate-6 drop-shadow-[6px_6px_0_var(--shadow)] lg:block" />}
      >
        Paste your URL. Jev crawls your site, writes the TL;DR, and scores how useful your business is from 1 to 1000. Ties are
        settled in the Duel Pit. Don't like the verdict? $5 buys a retrial.
      </PageMasthead>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="FAQ sections" className="lg:sticky lg:top-36 lg:self-start">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-ink-soft">On the docket</p>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {[...FAQ.map((group) => ({ id: group.id, label: group.title })), { id: "jevbot", label: "JevBot (crawler)" }].map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`inline-block border-2 border-line bg-card px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-jev hover:text-[#111110] lg:block lg:border-0 lg:bg-transparent lg:px-2 lg:py-1.5 lg:text-sm ${focusRing}`}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-6 hidden border-t-2 border-line pt-4 text-sm lg:block">
            <p className="font-bold">Still confused?</p>
            <p className="mt-1 text-ink-soft">Jev recommends getting judged. It clears things up.</p>
            <Link to="/#add" className={`btn mt-3 px-4 py-2 text-sm ${focusRing}`}>
              Get judged — $5
            </Link>
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-14">
          <FaqList groups={FAQ} />
          <JevBotSection userAgent={loaderData.userAgent} />
          <p className="text-sm text-ink-soft">
            The boring version lives in the{" "}
            <Link to="/terms" className={`font-bold text-ink underline ${focusRing}`}>
              terms
            </Link>
            . Jev is an AI. Jev's opinions are not financial, legal, or emotional advice. Jev is also not always right, just always
            confident.
          </p>
        </div>
      </div>
    </main>
  );
}
