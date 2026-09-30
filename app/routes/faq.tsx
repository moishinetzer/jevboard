import { Effect } from "effect";
import { AppConfig } from "~/.server/config";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { FAQ, faqJsonLd } from "~/components/pages/faq/content";
import { FaqList } from "~/components/pages/faq/faq-list";
import { JevBotSection } from "~/components/pages/faq/jevbot";
import { pageMeta } from "~/components/pages/meta";
import { PageHeader } from "~/components/shell";
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
      "Who Jev is, what Jev reads, why you can't buy a better rank, and how JevBot crawls your site. Answered by Jev, grudgingly.",
    path: "/faq",
    origin: loaderData?.origin,
  });

export default function Faq({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader />
      <main className="mx-auto w-full max-w-[780px] px-4 pt-12 sm:pt-[60px]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()).replace(/</g, "\\u003c") }}
        />
        <h1 className="headline text-center text-[40px] sm:text-[56px]">Questions</h1>
        <p className="mt-2.5 text-center text-[17px] text-soft">Answered by Jev, grudgingly.</p>
        <FaqList items={FAQ} />
        <JevBotSection userAgent={loaderData.userAgent} />
      </main>
    </>
  );
}
