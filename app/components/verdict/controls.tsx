import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Section heading in the tabloid style: kicker, huge title, optional right-hand meta. */
export function Section({
  id,
  kicker,
  title,
  meta,
  children,
  className,
}: {
  id: string;
  kicker?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={`scroll-mt-32 ${className ?? ""}`}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-[3px] border-line pb-2">
        <div className="min-w-0">
          {kicker ? (
            <p className="mb-1.5 inline-block bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-widest text-paper">
              {kicker}
            </p>
          ) : null}
          <h2 id={headingId} className="font-display text-4xl uppercase leading-[0.95] sm:text-5xl">
            {title}
          </h2>
        </div>
        {meta ? <div className="text-sm font-bold">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A row of radio buttons styled as chunky toggles. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <legend className="float-left mr-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-soft">
        {legend}
      </legend>
      {options.map((option) => (
        <label key={option.value} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="inline-block border-2 border-line bg-card px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-colors peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-hot hover:bg-jev hover:text-[#111110] peer-checked:hover:bg-ink peer-checked:hover:text-paper">
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * An image drawn over a look-alike stand-in. The stand-in shows while the real
 * image loads and stays if it fails (e.g. the OG/badge route isn't live yet),
 * so visitors never see a broken-image icon. Give it a `key` of the src so a
 * new src starts from the stand-in again.
 */
export function ImageWithStandIn({
  src,
  alt,
  standIn,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  standIn: ReactNode;
  className?: string;
  imgClassName?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  // The image may have settled before hydration attached the handlers.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete) setStatus(img.naturalWidth > 0 ? "loaded" : "failed");
  }, []);

  return (
    <div className={`grid ${className ?? ""}`}>
      <div className={`[grid-area:1/1] ${status === "loaded" ? "invisible" : ""}`} aria-hidden={status !== "failed"}>
        {standIn}
      </div>
      {status === "failed" ? null : (
        <img
          ref={ref}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
          className={`[grid-area:1/1] transition-opacity duration-300 ${status === "loaded" ? "opacity-100" : "opacity-0"} ${imgClassName ?? ""}`}
        />
      )}
    </div>
  );
}
