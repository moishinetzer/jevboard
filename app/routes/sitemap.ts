import { Effect } from "effect";
import { CurrentRequest, effectLoader } from "~/.server/http";
import { Board } from "~/.server/services/Board";
import { entryPath } from "~/lib/site-key";

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** GET /sitemap.xml — the static pages plus every verdict page on the board. */
export const loader = effectLoader("sitemap", () =>
  Effect.gen(function* () {
    const { origin } = yield* CurrentRequest;
    const board = yield* Board;
    const entries = yield* board.sitemap;
    const urls = [
      ...["/", "/faq"].map((path) => ({ loc: `${origin}${path}`, lastmod: null as number | null })),
      ...entries.map((entry) => ({ loc: `${origin}${entryPath(entry.siteKey)}`, lastmod: entry.lastJudgedAt })),
    ];
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          (url) =>
            `  <url><loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `<lastmod>${new Date(url.lastmod).toISOString()}</lastmod>` : ""}</url>`,
        )
        .join("\n") +
      `\n</urlset>\n`;
    return new Response(body, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
    });
  }),
);
