import type { MetaDescriptor } from "react-router";

/**
 * Title, description, Open Graph and Twitter tags for a content page.
 * Pass `origin` (from the loader) to get absolute URLs, which crawlers need.
 */
export const pageMeta = ({
  title,
  description,
  path,
  origin,
  image = "/og.png",
}: {
  title: string;
  description: string;
  path: string;
  origin?: string | undefined;
  image?: string;
}): Array<MetaDescriptor> => {
  const absolute = (href: string) => (origin ? `${origin}${href}` : href);
  const fullTitle = `${title} | Ranked by Jev`;
  return [
    { title: fullTitle },
    { name: "description", content: description },
    { property: "og:site_name", content: "Ranked by Jev" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:url", content: absolute(path) },
    { property: "og:image", content: absolute(image) },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: absolute(image) },
    { name: "theme-color", content: "#fcfaf3" },
    ...(origin ? [{ tagName: "link", rel: "canonical", href: absolute(path) } satisfies MetaDescriptor] : []),
  ];
};
