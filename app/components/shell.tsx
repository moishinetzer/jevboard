import { Link } from "react-router";
import { formatCount } from "~/lib/format";
import { JevFace, Wordmark } from "./logo";

/** Below this many views, the "Live" pill stays hidden rather than look lonely. */
const LIVE_PILL_MIN_VIEWS = 25;

/** The board's header: the logo, centred, and a quiet "Live" pill once people are looking. */
export function HomeHeader({ views }: { views: number }) {
  return (
    <header className="flex flex-col items-center gap-3 px-4 pt-7 sm:gap-3.5 sm:pt-10">
      <Link to="/" aria-label="Ranked by Jev home" className="flex items-center gap-2 text-ink">
        <JevFace size={34} label="" className="size-7 sm:size-[34px]" />
        <Wordmark className="text-[25px] sm:text-[30px]" />
      </Link>
      {views >= LIVE_PILL_MIN_VIEWS ? (
        <p className="flex items-center gap-2 rounded-full bg-pill py-1 pr-3 pl-1.5 text-xs text-soft sm:text-[13px]">
          <span className="rounded-full bg-jev px-2 py-0.5 text-[10px] font-bold text-on-jev sm:text-[11px]">Live</span>
          {/* All-time views, labelled "this week": the site runs as a one-week launch. */}
          <span>{formatCount(views)} views this week</span>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <a href="#board" className="link hidden sm:inline">
            See the board
          </a>
        </p>
      ) : null}
    </header>
  );
}

/** Every other page: the logo on the left, the way back on the right. */
export function PageHeader() {
  return (
    <header className="mx-auto flex w-full max-w-[780px] items-center justify-between gap-4 px-4 pt-7 sm:pt-9">
      <Link to="/" aria-label="Ranked by Jev home" className="flex items-center gap-2 text-ink">
        <JevFace size={30} label="" />
        <Wordmark className="text-[22px] sm:text-[26px]" />
      </Link>
      <Link to="/" className="link text-sm">
        <span aria-hidden>← </span>Back to the board
      </Link>
    </header>
  );
}

export function ModeBanner({ mode }: { mode: { payments: "autumn" | "fake"; judge: "live" | "mock" } }) {
  if (mode.payments === "autumn" && mode.judge === "live") return null;
  const parts = [
    mode.payments === "fake" ? "payments are simulated (no AUTUMN_SECRET_KEY)" : null,
    mode.judge === "mock" ? "Jev is a deterministic mock (no OPENROUTER_API_KEY)" : null,
  ].filter(Boolean);
  return (
    <div className="bg-jev px-4 py-1.5 text-center text-xs font-semibold text-on-jev">Dev mode: {parts.join(" · ")}</div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto flex flex-wrap justify-center gap-2 px-4 pt-10 pb-8 text-xs text-soft sm:text-[13px]">
      <span>Verdicts are Jev's opinions.</span>
      <span aria-hidden>·</span>
      <Link to="/faq" className="link font-normal">
        FAQ
      </Link>
      <span aria-hidden>·</span>
      <Link to="/terms" className="link font-normal">
        Terms
      </Link>
    </footer>
  );
}
