import { Link, NavLink } from "react-router";
import { formatCount, formatDuration, formatMoney } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { useLive, useNow } from "./live";
import { JevFace, Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { to: "/", label: "Board", end: true },
  { to: "/hall", label: "Hall of Fame & Shame" },
  { to: "/stats", label: "Receipts" },
  { to: "/faq", label: "FAQ" },
] as const;

export function SiteHeader() {
  const { counters } = useLive();
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Jevboard home">
          <JevFace size={38} className="animate-wiggle" />
          <Wordmark className="text-3xl" />
        </Link>
        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors ${
                  isActive ? "bg-ink text-paper" : "hover:bg-jev hover:text-[#111110]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs font-bold uppercase md:flex" title="People watching right now">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-hot" />
            </span>
            {formatCount(counters.online)} watching
          </span>
          <ThemeToggle />
          <Link to="/#judge" className="btn hidden px-4 py-2 text-sm sm:inline-flex">
            Get judged — $5
          </Link>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t-2 border-line px-4 py-1.5 lg:hidden" aria-label="Primary mobile">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              `shrink-0 px-2.5 py-1 text-xs font-bold uppercase ${isActive ? "bg-ink text-paper" : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

/** "The Tape": a scrolling marquee of everything that just happened on the board. */
export function Tape() {
  const { tape, fresh } = useLive();
  const items =
    tape.length > 0
      ? tape.slice(0, 20)
      : [{ id: -1, message: "The docket is empty. Be the first defendant. 👨‍⚖️", siteKey: null, kind: "placed" as const }];

  const renderItems = (hidden: boolean) =>
    items.map((event) => (
      <span key={`${hidden ? "b" : "a"}-${event.id}`} className="flex shrink-0 items-center gap-2 px-6" aria-hidden={hidden}>
        {fresh.has(event.id) ? <span className="sticker bg-hot! text-white!">new</span> : null}
        {event.siteKey ? (
          <Link to={entryPath(event.siteKey)} tabIndex={hidden ? -1 : undefined} className="hover:underline">
            {event.message}
          </Link>
        ) : (
          <span>{event.message}</span>
        )}
        <span className="text-jev-deep">✦</span>
      </span>
    ));

  return (
    <div className="relative flex border-b-[3px] border-line bg-ink text-paper" role="region" aria-label="The Tape: live board activity">
      <div className="z-10 flex shrink-0 items-center gap-2 bg-hot px-3 py-2 font-display text-lg uppercase tracking-wide text-white">
        <span className="size-2 animate-blink rounded-full bg-white" />
        The Tape
      </div>
      <div className="flex min-w-0 flex-1 overflow-hidden py-2 font-mono text-sm">
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
          {renderItems(false)}
          {renderItems(true)}
        </div>
      </div>
    </div>
  );
}

export function ModeBanner({ mode }: { mode: { payments: "autumn" | "fake"; judge: "claude" | "mock" } }) {
  if (mode.payments === "autumn" && mode.judge === "claude") return null;
  const parts = [
    mode.payments === "fake" ? "payments are simulated (no AUTUMN_SECRET_KEY)" : null,
    mode.judge === "mock" ? "Jev is a deterministic mock (no ANTHROPIC_API_KEY)" : null,
  ].filter(Boolean);
  return (
    <div className="border-b-2 border-dashed border-line bg-jev px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-[#111110]">
      🧪 Dev mode: {parts.join(" · ")}
    </div>
  );
}

export function SiteFooter() {
  const { counters } = useLive();
  const now = useNow(60_000);
  const since = counters.launchedAt ? formatDuration(now - counters.launchedAt) : null;
  return (
    <footer className="mt-24 border-t-[3px] border-line bg-paper-2">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <p className="font-display text-2xl uppercase leading-tight sm:text-3xl">
          Jev has been fed <span className="highlight">{formatMoney(counters.revenueCents)}</span> across{" "}
          {formatCount(counters.judgments)} judgment{counters.judgments === 1 ? "" : "s"}
          {since ? ` since launch ${since} ago` : " so far"}.
        </p>
        <div className="mt-8 grid gap-8 text-sm sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <JevFace size={28} />
              <Wordmark className="text-2xl" />
            </div>
            <p className="mt-2 text-ink-soft">
              Paste your site. Pay $5. Jev crawls it, writes the TL;DR and decides how useful your business is — from 1 to
              1000. You can't buy #1. You can only buy Jev's attention.
            </p>
          </div>
          <nav className="flex flex-col gap-1.5 font-bold" aria-label="Footer">
            <Link to="/" className="hover:underline">The Board</Link>
            <Link to="/hall" className="hover:underline">Hall of Fame &amp; Shame</Link>
            <Link to="/stats" className="hover:underline">Receipts (public stats)</Link>
            <Link to="/tv" className="hover:underline">TV mode</Link>
            <Link to="/faq" className="hover:underline">FAQ</Link>
            <Link to="/terms" className="hover:underline">Terms</Link>
          </nav>
          <p className="text-ink-soft">
            Jev is an AI. Jev's opinions are not financial, legal, or emotional advice. Jev is also not always right, just
            always confident. Each $5 buys one AI evaluation of a website — not a rank, a prize or a refund.
          </p>
        </div>
      </div>
    </footer>
  );
}
