import { isRouteErrorResponse, Link, type ShouldRevalidateFunction, useParams } from "react-router";
import { loadBoard } from "~/.server/flows/board";
import { effectLoader } from "~/.server/http";
import { BoardPage } from "~/components/board/board-page";
import { JudgeForm } from "~/components/judge-form";
import { JevFace } from "~/components/logo";
import { PageHeader } from "~/components/shell";
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
  const title = `${entry.name}: #${entry.rank} on Jevboard`;
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
    { property: "og:image:alt", content: `${entry.name} is #${entry.rank} on Jevboard with ${entry.score}` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "theme-color", content: "#fcfaf3" },
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
