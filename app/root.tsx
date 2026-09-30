import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunction,
} from "react-router";
import type { Route } from "./+types/root";
import { effectLoader } from "./.server/http";
import { loadShell } from "./.server/flows/shell";
import { visitorMiddleware } from "./.server/visitor";
import { JevFace } from "./components/logo";
import { ModeBanner, PageHeader, SiteFooter } from "./components/shell";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [visitorMiddleware];

export const loader = effectLoader("root", () => loadShell);

/** The shell only shows the provider mode, so the root loader re-runs after form submissions only. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod !== undefined && formMethod.toUpperCase() !== "GET" ? defaultShouldRevalidate : false;

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Ranked by Jev: think you're #1? Prove it for $5." },
  {
    name: "description",
    content:
      "No bidding, no ads, no buying your way up. Jev, an AI judge, reads your site and ranks how useful your business really is.",
  },
  { property: "og:site_name", content: "Ranked by Jev" },
  { property: "og:type", content: "website" },
  { property: "og:image", content: "/og.png" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "theme-color", content: "#fcfaf3" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-dvh flex-col">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <ModeBanner mode={loaderData.mode} />
      <Outlet />
      <SiteFooter />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let status = 500;
  let title = "Jev tripped over a cable";
  let details = "Something broke on our side. Jev has been told and is not pleased.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    const message = (error.data as { message?: string } | undefined)?.message;
    if (error.status === 404) {
      title = "Nothing here";
      details = message ?? "Jev looked everywhere. This page was never judged, or never existed.";
    } else if (error.status < 500) {
      title = "Objection";
      details = message ?? error.statusText ?? details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <>
      <PageHeader />
      <main className="mx-auto flex w-full max-w-[640px] flex-col items-center px-4 pt-16 text-center sm:pt-24">
        <JevFace size={88} mood="flat" label="Jev, unimpressed" />
        <p className="tag mt-6">Error {status}</p>
        <h1 className="headline mt-4 text-[40px] sm:text-[52px]">{title}</h1>
        <p className="mt-3.5 max-w-[500px] text-[17px] leading-relaxed text-soft">{details}</p>
        <Link to="/" className="btn mt-8 h-14 px-8 text-[17px]">
          Back to the board
        </Link>
        {stack ? (
          <pre className="panel mt-10 w-full overflow-x-auto p-4 text-left text-xs">
            <code>{stack}</code>
          </pre>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
