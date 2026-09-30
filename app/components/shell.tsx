import { Link } from "react-router";
import { focusJudgeInput, focusRing } from "./board/shared";
import { JevFace, Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        <Link to="/" className={`flex shrink-0 items-center gap-2 ${focusRing}`} aria-label="Jevboard home">
          <JevFace size={36} />
          <Wordmark className="text-3xl" />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <Link to="/#add" onClick={focusJudgeInput} className={`btn px-4 py-2 text-sm ${focusRing}`}>
            Add your business
          </Link>
        </div>
      </div>
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
    <div className="border-b-2 border-dashed border-line bg-jev px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-[#111110]">
      🧪 Dev mode: {parts.join(" · ")}
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t-[3px] border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-soft">
        <p className="max-w-xl">
          Jev is an AI. Scores are opinions, not advice. Each $5 buys one evaluation of a website, not a rank.
        </p>
        <nav className="flex gap-4 font-bold text-ink" aria-label="Footer">
          <Link to="/faq" className={`hover:underline ${focusRing}`}>
            FAQ
          </Link>
          <Link to="/terms" className={`hover:underline ${focusRing}`}>
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
