import { isRouteErrorResponse, Link, type ShouldRevalidateFunction, useParams } from "react-router";
import { loadBoard } from "~/.server/flows/board";
import { effectLoader } from "~/.server/http";
import { BoardPage } from "~/components/board/board-page";
import { boardClosed, boardWithOpen, reportRowView } from "~/components/board/cache";
import { JudgeForm } from "~/components/judge-form";
import { JevFace } from "~/components/logo";
import { PageHeader } from "~/components/shell";
import { ogPath } from "~/components/verdict/links";
import { entryPath, normalizeSite } from "~/lib/site-key";
import type { Route } from "./+types/board";

/**
 * The board (/) and the board with one business opened in place
 * (/s/acme.com, where shared links land). Both URLs use this module so that
 * opening and closing a row keeps the page mounted and can animate.
 */

const siteKeyFromParams = (splat: string | undefined): string =>
  decodeURIComponent(splat ?? "")
    .toLowerCase()
    .replace(/\/+$/, "");

const pageFrom = (search: URLSearchParams): number => Math.max(1, Math.floor(Number(search.get("page"))) || 1);

export const loader = effectLoader("board", ({ params }: Route.LoaderArgs) =>
  loadBoard("*" in params && params["*"] !== undefined ? siteKeyFromParams(params["*"]) : null),
);

/**
 * Opening, closing and going back and forth between rows is answered from the
 * board already in the browser (every listed business comes with its opened
 * row). The server is asked only for another page, a business that isn't
 * listed here, or the "checkout cancelled" notice.
 */
export async function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const search = new URL(request.url).searchParams;
  const splat = "*" in params ? params["*"] : undefined;
  if (splat === undefined) {
    return (search.has("cancelled") ? null : boardClosed(pageFrom(search))) ?? serverLoader();
  }
  const siteKey = siteKeyFromParams(splat);
  const cached = boardWithOpen(siteKey);
  if (!cached) return serverLoader();
  reportRowView(siteKey);
  return cached;
}

/** The $5 form posts to /judge: errors render inline and success leaves the page, so the board can't have changed. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formAction, defaultShouldRevalidate }) =>
  formAction === "/judge" ? false : defaultShouldRevalidate;

const TITLE = "Ranked by Jev: think you're #1? Jev will be the judge.";
const DESCRIPTION =
  "No bidding, no ads, no buying your way up. Jev reads your site and ranks how useful your business really is.";

export const meta: Route.MetaFunction = ({ loaderData, params }) => {
  const origin = loaderData?.origin ?? "";
  const entry = loaderData?.open;
  if (entry) {
    const url = `${origin}${entryPath(entry.siteKey)}`;
    const image = `${origin}${ogPath(entry.siteKey)}`;
    const title = `${entry.name}: #${entry.rank} on Ranked by Jev`;
    const description = entry.tldr;
    return [
      { title },
      { name: "description", content: description },
      { tagName: "link", rel: "canonical", href: url },
      { property: "og:site_name", content: "Ranked by Jev" },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${entry.name} is #${entry.rank} on Ranked by Jev with ${entry.score}` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
      { name: "theme-color", content: "#fcfaf3" },
    ];
  }
  if ("*" in params && params["*"] !== undefined) {
    return [{ title: "Not on the board | Ranked by Jev" }, { name: "robots", content: "noindex" }];
  }

  const leader = loaderData?.listing.page === 1 ? loaderData.listing.entries[0] : undefined;
  const description = leader ? `${DESCRIPTION} Currently #1: ${leader.name}.` : DESCRIPTION;
  const image = `${origin}/og.png`;
  return [
    { title: TITLE },
    { name: "description", content: description },
    { property: "og:site_name", content: "Ranked by Jev" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: description },
    { property: "og:url", content: `${origin}/` },
    { property: "og:image", content: image },
    { property: "og:image:alt", content: "Ranked by Jev: think you're #1? Jev will be the judge." },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "theme-color", content: "#fcfaf3" },
    { tagName: "link", rel: "canonical", href: `${origin}/` },
  ];
};

export default function Board({ loaderData }: Route.ComponentProps) {
  return <BoardPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const params = useParams();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const normalized = normalizeSite(siteKeyFromParams(params["*"]));
  const judgeable = notFound && normalized.ok ? normalized.site.siteKey : null;

  return (
    <>
      <PageHeader />
      <main className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4 pt-16 text-center sm:pt-[100px]">
        <JevFace size={88} mood="flat" label="Jev, looking for it" className="size-[72px] sm:size-[88px]" />
        <h1 className="headline mt-[22px] text-[40px] [overflow-wrap:anywhere] sm:text-[52px]">
          {!notFound ? (
            "This page fell over"
          ) : judgeable ? (
            <>
              <span className="text-accent">{judgeable}</span> isn't on the board yet
            </>
          ) : (
            "Not on the board"
          )}
        </h1>
        <p className="mt-3.5 max-w-[500px] text-base leading-relaxed text-soft sm:text-[17px]">
          {!notFound
            ? "The board couldn't be loaded right now. Try again in a moment."
            : judgeable
              ? "Add it and Jev will read the site, sum up what it does and decide where it ranks. Somebody has to go first."
              : "Paste a website below to see where it ranks."}
        </p>
        {notFound ? (
          judgeable ? (
            <JudgeForm
              siteUrl={judgeable}
              newSite
              className="mt-[30px]"
              buttonClassName="btn min-h-14 max-w-full px-8 py-3 text-[17px] whitespace-normal [overflow-wrap:anywhere]"
            />
          ) : (
            <JudgeForm className="mt-[30px] w-full" />
          )
        ) : null}
        <Link to="/" className="link mt-4 text-sm">
          {notFound ? "Or see who's on the board" : "Back to the board"}
        </Link>
      </main>
    </>
  );
}
