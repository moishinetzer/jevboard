import { isRouteErrorResponse, Link, type ShouldRevalidateFunction, useParams } from "react-router";
import { loadBoard } from "~/.server/flows/board";
import { effectLoader } from "~/.server/http";
import { BoardPage } from "~/components/board/board-page";
import { JudgeForm } from "~/components/judge-form";
import { JevFace } from "~/components/logo";
import { ogPath } from "~/components/verdict/links";
import { entryPath, normalizeSite } from "~/lib/site-key";
import type { Route } from "./+types/entry";

const siteKeyFromParams = (splat: string | undefined): string =>
  decodeURIComponent(splat ?? "")
    .toLowerCase()
    .replace(/\/+$/, "");

/** /s/acme.com: the board, with acme.com opened in place. Shared links land here. */
export const loader = effectLoader("entry", ({ params }: Route.LoaderArgs) => loadBoard(siteKeyFromParams(params["*"])));

export const shouldRevalidate: ShouldRevalidateFunction = ({ formAction, defaultShouldRevalidate }) =>
  formAction === "/judge" ? false : defaultShouldRevalidate;

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const entry = loaderData?.open?.entry;
  if (!loaderData || !entry) return [{ title: "Not on the board: Jevboard" }, { name: "robots", content: "noindex" }];
  const { origin } = loaderData;
  const url = `${origin}${entryPath(entry.siteKey)}`;
  const image = `${origin}${ogPath(entry.siteKey)}`;
  const title = `${entry.name}: ${entry.score}/1000 on Jevboard`;
  const description = entry.tldr;
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
  return <BoardPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const params = useParams();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const normalized = normalizeSite(siteKeyFromParams(params["*"]));
  const judgeable = notFound && normalized.ok ? normalized.site.siteKey : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:py-20">
      <JevFace size={96} className="mx-auto" />
      <h1 className="mt-6 font-display text-4xl leading-[0.95] uppercase [overflow-wrap:anywhere] sm:text-6xl">
        {!notFound ? "This page fell over" : judgeable ? `${judgeable} isn't on the board yet` : "Not on the board"}
      </h1>
      <p className="mx-auto mt-4 max-w-lg text-lg text-ink-soft">
        {!notFound
          ? "The verdict couldn't be loaded right now. Try again in a moment."
          : judgeable
            ? "Add it and Jev will read the site, sum it up and score how useful it is, from 1 to 1000."
            : "Paste a website below to see where it ranks."}
      </p>
      {notFound ? (
        <div className="slab mt-8 p-5 text-left">
          {judgeable ? <JudgeForm siteUrl={judgeable} newSite size="md" /> : <JudgeForm size="md" />}
        </div>
      ) : null}
      <Link to="/" className="btn btn-ghost mt-8 px-5 py-3">
        See the leaderboard
      </Link>
    </main>
  );
}
