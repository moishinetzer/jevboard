import { Effect, Option } from "effect";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { siteKeyFromAssetPath } from "~/.server/og/path";
import { Board } from "~/.server/services/Board";
import { buildBadge, buildNotJudgedBadge, parseBadgeStyle, parseBadgeTheme } from "~/lib/badge";
import { entryPath } from "~/lib/site-key";
import type { Route } from "./+types/badge";

const svgResponse = (svg: string, maxAge: number) =>
  new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=3600`,
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      // Opened directly, the SVG is a document: no scripts, no external loads.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });

/**
 * GET /badge/<siteKey>.svg[?theme=light|dark][&style=default|compact|big]
 * Embeddable "jevboard | #14 · 812" badge. Unknown sites get a grey
 * "not ranked yet" badge (200, so embeds never show a broken image).
 */
export const loader = effectLoader("badge", ({ params, request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const siteKey = siteKeyFromAssetPath(params["*"], "svg");
    const search = new URL(request.url).searchParams;
    const theme = parseBadgeTheme(search.get("theme"));
    const style = parseBadgeStyle(search.get("style"));
    const { origin } = yield* CurrentRequest;

    const board = yield* Board;
    const found = siteKey ? yield* board.findBySiteKey(siteKey) : Option.none();
    if (Option.isNone(found)) {
      return svgResponse(buildNotJudgedBadge(siteKey, { theme, style, href: `${origin}/` }), 300);
    }
    const entry = found.value;
    const { total } = yield* board.page({ page: 1, pageSize: 1 });
    const svg = buildBadge(
      { siteKey: entry.siteKey, score: entry.score, rank: entry.rank, total },
      { theme, style, href: `${origin}${entryPath(entry.siteKey)}` },
    );
    return svgResponse(svg, 300);
  }),
);
