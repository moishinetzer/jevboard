import { JevFace } from "~/components/logo";

/** Jev, speaking: the roast as a speech bubble. */
export function RoastBubble({ verdict, className }: { verdict: string; className?: string }) {
  return (
    <figure className={`flex items-start gap-3 sm:gap-5 ${className ?? ""}`}>
      <JevFace size={64} className="mt-1 size-12 shrink-0 sm:size-18" />
      <div className="relative min-w-0 flex-1 border-[3px] border-line bg-card px-4 py-4 shadow-[5px_5px_0_var(--shadow)] sm:px-6 sm:py-5">
        <span
          aria-hidden
          className="absolute top-5 -left-[11px] size-[18px] rotate-45 border-b-[3px] border-l-[3px] border-line bg-card"
        />
        <blockquote className="text-xl leading-snug font-bold text-pretty sm:text-[1.7rem]">“{verdict}”</blockquote>
        <figcaption className="mt-3 font-mono text-[11px] font-bold tracking-widest text-ink-soft uppercase">
          — Jev, presiding
        </figcaption>
      </div>
    </figure>
  );
}
