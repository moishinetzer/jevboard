import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRouteLoaderData } from "react-router";
import type { PreviewResult } from "~/.server/flows/preview";
import type { SubmitFailure } from "~/.server/flows/submit";
import { capture, reportExposure } from "~/components/analytics";
import { JevFace } from "~/components/logo";
import { PayLine, PriceBadge, type Pricing, priceButtonLabel } from "~/components/price-cta";
import { SiteIcon } from "~/components/ui";
import { DEFAULT_VARIANTS, FLAGS } from "~/lib/experiments";
import { normalizeSite } from "~/lib/site-key";
import type { loader as rootLoader } from "~/root";

export interface TopEntry {
  readonly rank: number;
  readonly siteKey: string;
  readonly host: string;
  readonly title: string;
  readonly iconUrl: string | null;
}

const STEPS = 5;
const MAX_STRENGTHS = 3;
/** The "reading" checklist ticks while Jev works: real steps, shown as they'd happen. */
const TICK_MS = 850;
const TOP_TINT: Record<number, string> = { 1: "bg-accent/14", 2: "bg-accent/8", 3: "bg-accent/4" };

/** "Balloons Online USA - Shop latex, mylar…" → "Balloons Online USA"; the host when that's no better. */
const shortName = (title: string, fallback: string): string => {
  const first = title.split(/\s*[|:]\s+|\s+[-–—·]\s+|\s*\|\s*/)[0]?.trim() ?? "";
  return first.length >= 2 && first.length <= 32 ? first : fallback;
};

/**
 * Test B of the onboarding: Jev reads the site first and the buyer pays last.
 * 1. Jev reads the site (a live checklist), "Is this you?"
 * 2. What it does, who it's for (Jev's guesses, editable)
 * 3. What makes it #1 (pick up to three; Jev checks them against the site)
 * 4. Their row among the top three, and where visitors land
 * 5. Pay: Jev's first impression, what they get, the price test's button
 * If Jev can't prepare the questions (busy or failed), it skips to step 5.
 */
export function GuidedFlow({ url, views, top }: { url: string; views: number; top: ReadonlyArray<TopEntry> }) {
  const preview = useFetcher<PreviewResult>();
  const checkout = useFetcher<SubmitFailure>();
  const shell = useRouteLoaderData<typeof rootLoader>("root");
  const experiments = shell?.experiments ?? DEFAULT_VARIANTS;
  const pricing: Pricing = { variant: experiments.price, wallet: shell?.wallet ?? "card", views };

  const [step, setStep] = useState(1);
  const [ticks, setTicks] = useState(0);
  const [summary, setSummary] = useState("");
  const [audiences, setAudiences] = useState<ReadonlyArray<string>>([]);
  const [strengths, setStrengths] = useState<ReadonlyArray<string>>([]);
  const [note, setNote] = useState("");
  const [landing, setLanding] = useState<string | null>(null);

  const normalized = normalizeSite(url);
  const result = preview.data;
  const read = result?.ok ? result : null;
  const failed = result && !result.ok ? result : null;
  const skipped = failed !== null && failed.field !== "url";
  const host = read?.site.host ?? (normalized.ok ? normalized.site.host : url);
  const siteKey = read?.site.siteKey ?? (normalized.ok ? normalized.site.siteKey : url);
  const name = read ? shortName(read.profile.title, host) : host;
  // Exactly what the board will show: the site's own title and description (never the buyer's edits).
  const rowTitle = read?.profile.title || name;
  const rowDescription = read?.profile.description || "";

  // Ask Jev once (StrictMode runs effects twice in development).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void preview.submit({ url }, { method: "post", action: "/api/preview" });
  }, [preview, url]);

  useEffect(() => {
    if (step !== 1 || ticks >= 3) return;
    const timer = setTimeout(() => setTicks((n) => n + 1), TICK_MS);
    return () => clearTimeout(timer);
  }, [step, ticks]);

  // Jev's guesses become the starting answers, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (!result || seeded.current) return;
    seeded.current = true;
    if (result.ok) {
      setSummary(result.preview.summary);
      setAudiences(result.preview.audiences.filter((item) => item.likely).map((item) => item.label));
      setStrengths(result.preview.strengths.filter((item) => item.picked).map((item) => item.label).slice(0, MAX_STRENGTHS));
      setLanding(result.preview.landingPages[0]?.url ?? null);
    } else if (result.field !== "url") {
      setStep(STEPS);
    }
  }, [result]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    capture("onboarding_step_viewed", { step, site: siteKey, skipped });
    if (step === STEPS) reportExposure(FLAGS.price, experiments.assigned.price);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list: ReadonlyArray<string>, item: string, max: number): ReadonlyArray<string> =>
    list.includes(item) ? list.filter((value) => value !== item) : list.length >= max ? list : [...list, item];

  const intake = read ? JSON.stringify({ summary, audiences, strengths, note, landingUrl: landing }) : "";
  const readyToConfirm = read !== null && ticks >= 3;
  const checkoutBusy = checkout.state !== "idle";
  const checkoutError = checkout.data && checkout.data.ok === false ? checkout.data : null;

  const row = (
    <RowPreview
      host={host}
      iconUrl={read?.profile.icon ?? null}
      title={rowTitle}
      description={rowDescription}
      meta={host}
    />
  );

  let content: ReactNode;
  let cta: ReactNode;
  if (step === 1) {
    const checks = [`Opened ${host}`, "Found your name, logo and description", "Read your headlines and a few more pages", "Working out what you do"];
    content = (
      <>
        <Heading>
          Jev is reading <span className="text-accent [overflow-wrap:anywhere]">{host}</span>
        </Heading>
        <ol aria-label="What Jev has done so far" className="mt-6 flex flex-col gap-3 text-[15px]">
          {checks.map((label, index) => {
            const done = index < 3 ? ticks > index || read !== null : read !== null && ticks >= 3;
            return (
              <li key={label} className={`flex items-center gap-2.5 ${done ? "text-ink" : "text-soft"}`}>
                {done ? <Tick /> : failed?.field === "url" ? <Cross /> : <Spinner />}
                {label}
              </li>
            );
          })}
        </ol>
        {failed?.field === "url" ? (
          <div role="alert" className="mt-7 rounded-2xl border border-bad/40 px-4 py-3.5">
            <p className="font-bold">Jev couldn't read {host}</p>
            <p className="mt-1 text-sm text-soft">{failed.message}</p>
          </div>
        ) : readyToConfirm ? (
          <div className="mt-8">
            <p className="font-display text-xl font-bold tracking-tight">Is this you?</p>
            <p className="mt-1 text-sm text-soft">This is how your row will look on the board, straight from your site.</p>
            <div className="mt-3.5 lg:hidden">{row}</div>
          </div>
        ) : null}
      </>
    );
    cta =
      failed?.field === "url" ? (
        <Link to="/#add" className="btn h-14 w-full text-[17px]">
          Try another address
        </Link>
      ) : (
        <>
          <button type="button" disabled={!readyToConfirm} onClick={() => setStep(2)} className="btn h-14 w-full text-[17px]">
            {readyToConfirm ? "Yes, that's us" : "Jev is reading…"}
          </button>
          <Link to="/#add" className="btn btn-ghost h-12 w-full text-[15px]">
            Not you? Use another address
          </Link>
        </>
      );
  } else if (step === 2 && read) {
    content = (
      <>
        <Heading>What does {name} do?</Heading>
        <JevSays className="mt-5">From your homepage, I'd put it like this. Fix anything I got wrong.</JevSays>
        <label className="mt-5 flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">In one line</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={200}
            rows={3}
            className="resize-none rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-3 text-base leading-snug outline-none focus:border-accent"
          />
        </label>
        <p className="mt-6 text-[13px] font-bold">Who is it for?</p>
        <p className="mt-0.5 text-[13px] text-soft">Jev picked the ones your site talks to. Tap to change.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {read.preview.audiences.map((item) => (
            <Chip key={item.label} on={audiences.includes(item.label)} onClick={() => setAudiences(toggle(audiences, item.label, 6))}>
              {item.label}
            </Chip>
          ))}
        </div>
      </>
    );
    cta = (
      <button type="button" onClick={() => setStep(3)} className="btn h-14 w-full text-[17px]">
        Continue
      </button>
    );
  } else if (step === 3 && read) {
    content = (
      <>
        <Heading>
          What makes {name} <span className="text-accent">#1?</span>
        </Heading>
        <p className="mt-3 text-[15px] leading-normal text-soft">Jev found these on your site. Pick up to three you'd stake your ranking on.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {read.preview.strengths.map((item) => {
            const on = strengths.includes(item.label);
            return (
              <Chip
                key={item.label}
                on={on}
                disabled={!on && strengths.length >= MAX_STRENGTHS}
                title={item.evidence}
                onClick={() => setStrengths(toggle(strengths, item.label, MAX_STRENGTHS))}
              >
                {item.label}
              </Chip>
            );
          })}
        </div>
        <p className="mt-2.5 text-[13px] font-semibold text-soft">
          {strengths.length} of {MAX_STRENGTHS} picked
        </p>
        <label className="mt-6 flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">
            Anything Jev might miss? <span className="font-medium text-soft">Optional</span>
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={280}
            rows={3}
            placeholder="Something your site doesn't say yet, like who already uses it."
            className="resize-none rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-3 text-base leading-snug outline-none placeholder:text-soft/70 focus:border-accent"
          />
        </label>
        <p className="mt-3.5 flex items-center gap-2 text-[13px] text-soft">
          <JevFace size={22} label="" className="size-[22px] shrink-0" />
          Jev checks every claim against your site. Bold claims help only if they hold up.
        </p>
      </>
    );
    cta = (
      <button type="button" onClick={() => setStep(4)} className="btn h-14 w-full text-[17px]">
        Continue
      </button>
    );
  } else if (step === 4 && read) {
    content = (
      <>
        <Heading>Here's your row</Heading>
        <p className="mt-3 text-[15px] leading-normal text-soft">{name} joins these businesses. Jev decides where it lands.</p>
        <ol aria-label="The board, with your row" className="mt-4 flex flex-col gap-1 rounded-[20px] border border-line bg-card p-1.5">
          {top.map((entry) => (
            <li
              key={entry.siteKey}
              className={`grid grid-cols-[26px_36px_minmax(0,1fr)] items-center gap-x-2.5 rounded-[14px] py-2 pr-2.5 pl-1 ${TOP_TINT[entry.rank] ?? ""}`}
            >
              <span className="text-center font-display text-sm font-bold text-accent">#{entry.rank}</span>
              <SiteIcon host={entry.host} iconUrl={entry.iconUrl} className="size-9" />
              <span className="truncate text-sm font-bold">{entry.title}</span>
            </li>
          ))}
          <li className="mt-1">
            <RowPreview
              dashed
              host={host}
              iconUrl={read.profile.icon}
              title={rowTitle}
              description={rowDescription}
              meta={`${host} · your row`}
            />
          </li>
        </ol>
        {read.preview.landingPages.length > 1 ? (
          <fieldset className="mt-6">
            <legend className="text-[13px] font-bold">Where should people land when they click?</legend>
            <div className="mt-2.5 flex flex-col gap-2">
              {read.preview.landingPages.map((page) => (
                <label
                  key={page.url}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] border-[1.5px] bg-card px-3.5 py-2 ${landing === page.url ? "border-accent" : "border-line"}`}
                >
                  <input
                    type="radio"
                    name="landing"
                    checked={landing === page.url}
                    onChange={() => setLanding(page.url)}
                    className="size-[18px] shrink-0 accent-[var(--accent)]"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">{page.label}</span>
                    <span className="truncate text-xs text-soft">{page.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </>
    );
    cta = (
      <button type="button" onClick={() => setStep(5)} className="btn h-14 w-full text-[17px]">
        Looks good
      </button>
    );
  } else {
    content = (
      <>
        {read ? <span className="tag self-start">Ready for Jev</span> : null}
        <Heading className={read ? "mt-3" : ""}>
          Jev's ready to rank <span className="text-accent [overflow-wrap:anywhere]">{name}</span>
        </Heading>
        {read ? (
          <figure className="mt-5 flex items-start gap-2.5">
            <JevFace size={34} label="Jev" className="size-[34px] shrink-0" />
            <div className="rounded-[4px_16px_16px_16px] border border-line bg-card px-3.5 py-2.5">
              <figcaption className="text-xs font-bold text-soft">First impression</figcaption>
              <blockquote className="mt-1 text-[15px] leading-snug italic">“{read.preview.firstImpression}”</blockquote>
            </div>
          </figure>
        ) : null}
        <div className="mt-4 lg:hidden">{row}</div>
        {read && strengths.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {strengths.map((item) => (
              <span key={item} className="rounded-full bg-pill px-2.5 py-1 text-xs font-semibold">
                {item}
              </span>
            ))}
            <button type="button" onClick={() => setStep(3)} className="link px-1.5 py-1 text-xs">
              Edit
            </button>
          </div>
        ) : null}
        <p className="mt-6 text-[13px] font-bold">What you get</p>
        <ul className="mt-2.5 flex flex-col gap-2.5 text-[15px]">
          {["Your rank on the public board", "Jev's full verdict, and why", "Your row, with your logo and a link to your site", "A share card and a badge for your site"].map(
            (item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Tick small />
                {item}
              </li>
            ),
          )}
        </ul>
        <p className="mt-5 flex items-start gap-2 text-[13px] leading-normal text-soft">
          <ShieldIcon />
          If Jev can't read your site, your money comes back automatically.
        </p>
      </>
    );
    cta = (
      <checkout.Form method="post" action="/judge" className="flex flex-col items-center">
        <input type="hidden" name="url" value={url} />
        {intake ? <input type="hidden" name="intake" value={intake} /> : null}
        <PriceBadge variant={pricing.variant} className="mb-3" />
        <button type="submit" disabled={checkoutBusy} className="btn h-14 w-full text-[17px]">
          {checkoutBusy ? "Opening checkout…" : priceButtonLabel(pricing.variant)}
        </button>
        <div aria-live="polite" className="w-full text-center">
          {checkoutError ? (
            <p className="mt-2.5 text-sm font-semibold text-bad">{checkoutError.message}</p>
          ) : (
            <PayLine pricing={pricing} className="mt-2.5" />
          )}
        </div>
      </checkout.Form>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col">
      <header className="mx-auto w-full max-w-[1040px] px-4 pt-3 sm:px-6 sm:pt-6">
        <div className="flex h-11 items-center justify-between">
          {step === 1 || skipped ? (
            <Link to="/" aria-label="Back to the board" className="-ml-3 grid size-11 place-items-center text-ink">
              <ChevronLeft />
            </Link>
          ) : (
            <button type="button" aria-label="Back" onClick={() => setStep(step - 1)} className="-ml-3 grid size-11 place-items-center text-ink">
              <ChevronLeft />
            </button>
          )}
          <span className="text-[13px] font-semibold text-soft">
            Step {step} of {STEPS}
          </span>
          <Link to="/" aria-label="Ranked by Jev home" className="-mr-1.5 grid size-11 place-items-center">
            <JevFace size={30} label="" className="size-[30px]" />
          </Link>
        </div>
        <div role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step} className="mt-1.5 grid grid-cols-5 gap-1.5">
          {Array.from({ length: STEPS }, (_, index) => (
            <span key={index} className={`h-[5px] rounded-full transition-colors duration-300 ${index < step ? "bg-jev" : "bg-line"}`} />
          ))}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1040px] flex-1 gap-12 px-4 pt-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16 lg:pt-12">
        <section className="flex min-w-0 flex-col">
          {content}
          {/* Phones keep the next step under the thumb; desktops show it under the question. */}
          <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex flex-col gap-2.5 border-t border-line bg-paper px-4 pt-3 pb-4 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-12">
            {cta}
          </div>
        </section>
        <aside aria-label="Your row" className="hidden lg:block">
          <div className="sticky top-8">
            <p className="text-xs font-bold tracking-wide text-soft uppercase">Your row, as it'll look</p>
            <div className="mt-3">{row}</div>
            {strengths.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {strengths.map((item) => (
                  <span key={item} className="rounded-full bg-pill px-2.5 py-1 text-xs font-semibold">
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-[13px] text-soft">
              {strengths.length > 0 ? "Above: what you'll tell Jev. " : ""}Jev decides where it lands once you've paid.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Heading({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={`headline text-[32px] sm:text-[44px] ${className ?? ""}`}>{children}</h1>;
}

function JevSays({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-2.5 ${className ?? ""}`}>
      <JevFace size={34} label="Jev" className="size-[34px] shrink-0" />
      <p className="rounded-[4px_16px_16px_16px] border border-line bg-card px-3.5 py-2.5 text-sm leading-normal">{children}</p>
    </div>
  );
}

function RowPreview({
  host,
  iconUrl,
  title,
  description,
  meta,
  dashed = false,
}: {
  host: string;
  iconUrl: string | null;
  title: string;
  description: string;
  meta: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[28px_auto_minmax(0,1fr)] items-center gap-x-3 rounded-2xl py-3 pr-3 pl-1.5 ${dashed ? "border-2 border-dashed border-accent" : "border-[1.5px] border-line bg-card"}`}
    >
      <span className="text-center font-display text-base font-bold text-soft">#?</span>
      <SiteIcon host={host} iconUrl={iconUrl} className="size-11" />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-bold">{title}</p>
        {description ? <p className="mt-0.5 truncate text-[13px] text-soft">{description}</p> : null}
        <p className="mt-0.5 truncate text-xs text-soft">{meta}</p>
      </div>
    </div>
  );
}

function Chip({
  on,
  disabled = false,
  title,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${on ? "border-jev bg-jev text-on-jev" : "border-line bg-card text-ink hover:border-soft"}`}
    >
      {on ? <CheckIcon /> : null}
      {children}
    </button>
  );
}

function Tick({ small = false }: { small?: boolean }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-jev text-on-jev ${small ? "mt-px size-[22px]" : "size-6"}`}>
      <CheckIcon />
    </span>
  );
}

function Spinner() {
  return <span aria-hidden className="size-6 shrink-0 animate-spin rounded-full border-[3px] border-line border-t-accent" />;
}

function Cross() {
  return (
    <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] border-bad/50 text-bad">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5 10 17 19 7" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
    </svg>
  );
}
