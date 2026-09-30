import type { ShouldRevalidateFunction } from "react-router";
import { loadBoard } from "~/.server/flows/board";
import { effectLoader } from "~/.server/http";
import { BoardPage } from "~/components/board/board-page";
import type { Route } from "./+types/home";

export const loader = effectLoader("home", () => loadBoard(null));

/** The $5 form posts to /judge: errors render inline and success leaves the page, so the board can't have changed. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formAction, defaultShouldRevalidate }) =>
  formAction === "/judge" ? false : defaultShouldRevalidate;

const TITLE = "Ranked by Jev: think you're #1? Prove it for $5.";
const DESCRIPTION =
  "No bidding, no ads, no buying your way up. Jev, an AI judge, reads your site and ranks how useful your business really is.";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const origin = loaderData?.origin ?? "";
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
    { property: "og:image:alt", content: "Ranked by Jev: think you're #1? Prove it for $5." },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "theme-color", content: "#fcfaf3" },
    { tagName: "link", rel: "canonical", href: `${origin}/` },
  ];
};

export default function Home({ loaderData }: Route.ComponentProps) {
  return <BoardPage data={loaderData} />;
}
