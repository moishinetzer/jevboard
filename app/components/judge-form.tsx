import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

interface SubmitFailure {
  readonly ok: false;
  readonly field: "url" | "payment" | "rate";
  readonly message: string;
  readonly value: string;
}

const CHECKING_LINES = [
  "Jev is checking your site exists…",
  "Knocking on the front door…",
  "Making sure it's not a parked domain…",
  "Warming up the gavel…",
];

/**
 * "Add my business · $5" / "Rejudge · $5".
 *
 * Posts to /judge with a fetcher: validation errors render inline, success
 * redirects to checkout. Pass `siteUrl` to render a one-click retrial button
 * for an existing entry instead of the URL input.
 */
export function JudgeForm({
  siteUrl,
  newSite = false,
  size = "lg",
  autoFocus = false,
  className,
}: {
  /** When set, the form is a one-click button for this URL (no input): a rejudge, or with `newSite` a first judgment. */
  siteUrl?: string;
  newSite?: boolean;
  size?: "lg" | "md";
  autoFocus?: boolean;
  className?: string;
}) {
  const fetcher = useFetcher<SubmitFailure>();
  const busy = fetcher.state !== "idle";
  const failure = fetcher.data && fetcher.data.ok === false ? fetcher.data : null;
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!busy) return setLine(0);
    const id = setInterval(() => setLine((current) => (current + 1) % CHECKING_LINES.length), 1400);
    return () => clearInterval(id);
  }, [busy]);

  const isRetrial = siteUrl !== undefined && !newSite;
  const oneClick = siteUrl !== undefined;
  const label = isRetrial ? "Rejudge · $5" : oneClick ? `Add ${siteUrl} · $5` : "Add my business · $5";
  const big = size === "lg";

  return (
    <fetcher.Form method="post" action="/judge" className={className}>
      {oneClick ? (
        <input type="hidden" name="url" value={siteUrl} />
      ) : (
        <div className={`flex flex-col gap-3 ${big ? "sm:flex-row" : ""}`}>
          <label className="sr-only" htmlFor="judge-url">
            Your website URL
          </label>
          <input
            id="judge-url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus={autoFocus}
            defaultValue={failure?.value ?? ""}
            placeholder="yourbusiness.com"
            aria-invalid={failure?.field === "url" ? true : undefined}
            aria-describedby={failure ? "judge-error" : undefined}
            className={`min-w-0 flex-1 border-[3px] border-line bg-card font-mono text-ink shadow-[4px_4px_0_var(--shadow)] placeholder:text-ink-soft/60 focus:bg-jev/20 focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-hot ${
              big ? "px-4 py-4 text-xl" : "px-3 py-2.5 text-base"
            }`}
          />
          <button type="submit" disabled={busy} className={`btn ${big ? "px-7 py-4 text-xl" : "px-4 py-2.5"}`}>
            {busy ? "Checking…" : label}
          </button>
        </div>
      )}
      {oneClick ? (
        <button type="submit" disabled={busy} className={`btn ${isRetrial ? "btn-hot" : ""} ${big ? "px-6 py-4 text-lg" : "px-4 py-2.5"}`}>
          {busy ? "Checking…" : label}
        </button>
      ) : null}
      <div aria-live="polite" className="min-h-6">
        {busy ? (
          <p className="mt-3 font-mono text-sm font-bold">{CHECKING_LINES[line]}</p>
        ) : failure ? (
          <p id="judge-error" className="mt-3 font-bold text-hot">
            ⚠️ {failure.message}
          </p>
        ) : null}
      </div>
    </fetcher.Form>
  );
}
