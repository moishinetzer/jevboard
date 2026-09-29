import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunction,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { effectLoader } from "./.server/http";
import { loadShell } from "./.server/flows/shell";
import { visitorMiddleware } from "./.server/visitor";
import { LiveProvider } from "./components/live";
import { JevFace } from "./components/logo";
import { ModeBanner, SiteFooter, SiteHeader, Tape } from "./components/shell";
import { themeBootScript } from "./components/theme-toggle";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [visitorMiddleware];

export const loader = effectLoader("root", () => loadShell);

/**
 * The shell's live data refreshes itself through /api/feed, so the root loader
 * only re-runs after form submissions — not on every navigation or poll.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) =>
  formMethod !== undefined && formMethod.toUpperCase() !== "GET" ? defaultShouldRevalidate : false;

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Jevboard — Pay $5. Get judged by Jev." },
  {
    name: "description",
    content:
      "Paste your site. Pay $5. Jev crawls it, writes the TL;DR and decides how useful your business is, from 1 to 1000. You can't buy #1 — you can only buy Jev's attention.",
  },
  { property: "og:site_name", content: "Jevboard" },
  { property: "og:type", content: "website" },
  { property: "og:image", content: "/og.png" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "theme-color", content: "#ffd400" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <LiveProvider tape={loaderData.tape} counters={loaderData.counters} now={loaderData.now}>
      <ModeBanner mode={loaderData.mode} />
      <SiteHeader />
      <Tape />
      <Outlet />
      <SiteFooter />
    </LiveProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const shell = useRouteLoaderData<typeof loader>("root");
  let status = 500;
  let title = "Jev tripped over a cable";
  let details = "Something broke on our side. Jev has been informed and is furious.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    const message = (error.data as { message?: string } | undefined)?.message;
    if (error.status === 404) {
      title = "Not on the docket";
      details = message ?? "Jev has no record of this page. Maybe it was never judged — or never existed.";
    } else {
      title = error.status >= 500 ? title : "Objection!";
      details = message ?? error.statusText ?? details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  const body = (
    <main className="mx-auto max-w-3xl px-4 py-20 text-center">
      <JevFace size={96} className="mx-auto" />
      <p className="mt-6 font-mono text-sm font-bold uppercase tracking-widest text-hot">Error {status}</p>
      <h1 className="mt-2 font-display text-5xl uppercase sm:text-7xl">{title}</h1>
      <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">{details}</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/" className="btn px-5 py-3">
          Back to the board
        </Link>
        <Link to="/#judge" className="btn btn-ghost px-5 py-3">
          Get judged — $5
        </Link>
      </div>
      {stack ? (
        <pre className="slab mt-10 overflow-x-auto p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );

  if (!shell) return body;
  return (
    <LiveProvider tape={shell.tape} counters={shell.counters} now={shell.now}>
      <SiteHeader />
      <Tape />
      {body}
      <SiteFooter />
    </LiveProvider>
  );
}
