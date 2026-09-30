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
 * The $5 form. Posts to /judge with a fetcher: validation errors render
 * inline, success redirects to checkout.
 *
 * Without `siteUrl` it's the URL field plus "Get my ranking". With `siteUrl`
 * it's one button for that site: "Rejudge", or with `newSite` a first
 * judgment ("Get acme.com ranked").
 */
export function JudgeForm({
  siteUrl,
  newSite = false,
  label,
  autoFocus = false,
  className,
  buttonClassName,
}: {
  siteUrl?: string;
  newSite?: boolean;
  /** Overrides the button text. */
  label?: string;
  autoFocus?: boolean;
  className?: string;
  /** Classes for the one-click button (size and width). */
  buttonClassName?: string;
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

  const oneClick = siteUrl !== undefined;
  const text = label ?? (!oneClick ? "Get my ranking" : newSite ? `Get ${hostOf(siteUrl)} ranked` : "Rejudge");

  return (
    <fetcher.Form method="post" action="/judge" className={className}>
      {oneClick ? (
        <>
          <input type="hidden" name="url" value={siteUrl} />
          <button type="submit" disabled={busy} className={buttonClassName ?? "btn h-10 px-4 text-sm"}>
            {busy ? "Checking…" : text}
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label className="flex h-[52px] min-w-0 items-center sm:flex-1 gap-2.5 rounded-full border-[1.5px] border-line bg-card pr-4 pl-4 shadow-[0_1px_2px_rgba(29,27,22,0.04)] focus-within:border-accent sm:h-14 sm:pr-2 sm:pl-[18px]">
            <GlobeIcon />
            <span className="sr-only">Your website</span>
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
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-soft/70 sm:text-[17px]"
            />
          </label>
          <button type="submit" disabled={busy} className="btn h-[52px] px-[30px] text-base sm:h-14 sm:text-[17px]">
            {busy ? "Checking…" : text}
          </button>
        </div>
      )}
      <div aria-live="polite">
        {busy ? (
          <p className="mt-2.5 text-sm font-medium text-soft">{CHECKING_LINES[line]}</p>
        ) : failure ? (
          <p id="judge-error" className="mt-2.5 text-sm font-semibold text-bad">
            {failure.message}
          </p>
        ) : null}
      </div>
    </fetcher.Form>
  );
}

const hostOf = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="shrink-0 text-soft">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}
