import { Effect, Option } from "effect";
import { AppConfig } from "~/.server/config";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { FAQ, faqJsonLd, withModel } from "~/components/pages/faq/content";
import { FaqList } from "~/components/pages/faq/faq-list";
import { JevBotSection } from "~/components/pages/faq/jevbot";
import { pageMeta } from "~/components/pages/meta";
import { PageHeader } from "~/components/shell";
import type { Route } from "./+types/faq";

export const loader = effectLoader("faq", () =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const { origin } = yield* CurrentRequest;
    // Named in "What's under the hood?"; the deterministic mock stands in when there's no OpenRouter key.
    const model = Option.match(config.openrouter, { onNone: () => "a deterministic mock", onSome: (o) => o.model });
    return { userAgent: config.crawlUserAgent, origin, model };
  }),
);

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: "FAQ",
    description:
      "Who Jev is (an AI judge), what's under the hood, why you can't buy a better rank, and how JevBot crawls your site. Answered by Jev, grudgingly.",
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(loaderData.model)).replace(/</g, "\\u003c") }}
        />
        <h1 className="headline text-center text-[40px] sm:text-[56px]">Questions</h1>
        <p className="mt-2.5 text-center text-[17px] text-soft">Answered by Jev, grudgingly.</p>
        <FaqList items={FAQ.map((item) => ({ ...item, answer: withModel(item.answer, loaderData.model) }))} />
        <JevBotSection userAgent={loaderData.userAgent} />
      </main>
    </>
  );
}
