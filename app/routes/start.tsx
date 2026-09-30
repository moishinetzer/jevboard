import { Effect } from "effect";
import { redirect } from "react-router";
import { effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { BOARD_VIEWS, Views } from "~/.server/services/Views";
import { GuidedFlow } from "~/components/onboarding/guided-flow";
import type { Route } from "./+types/start";

/**
 * /start?url=acme.com: the guided onboarding (test B). Jev reads the site,
 * the buyer confirms what it does, who it's for and what makes it #1, sees
 * their row, and pays last. The steps run in the browser; Jev's read comes
 * from /api/preview and checkout goes through /judge like the plain form.
 */
export const loader = effectLoader("start", ({ request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const url = (new URL(request.url).searchParams.get("url") ?? "").trim().slice(0, 500);
    if (url === "") return redirect("/#add");
    const top = yield* (yield* Board).top(3);
    const views = (yield* (yield* Views).allTime([BOARD_VIEWS])).get(BOARD_VIEWS) ?? 0;
    return {
      url,
      views,
      top: top.map((entry) => ({
        rank: entry.rank,
        siteKey: entry.siteKey,
        host: entry.host,
        title: entry.siteTitle ?? entry.name,
        iconUrl: entry.iconUrl,
      })),
    };
  }),
);

export const meta: Route.MetaFunction = () => [
  { title: "Get your ranking | Ranked by Jev" },
  { name: "robots", content: "noindex" },
];

export default function Start({ loaderData }: Route.ComponentProps) {
  return <GuidedFlow url={loaderData.url} views={loaderData.views} top={loaderData.top} />;
}
