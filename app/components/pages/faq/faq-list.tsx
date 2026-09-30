import { useEffect } from "react";
import { CONTACT_EMAIL, type FaqItem } from "./content";

/** Opens the <details> a #fragment points at (on load and on in-page jumps). */
const useOpenTargetedDetails = () => {
  useEffect(() => {
    const openTarget = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) target.open = true;
    };
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);
};

/** Answers are plain text; the contact address becomes a mailto link. */
const renderAnswer = (text: string) =>
  text.split(CONTACT_EMAIL).flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <a key={index} href={`mailto:${CONTACT_EMAIL}`} className="link">
            {CONTACT_EMAIL}
          </a>,
          part,
        ],
  );

/** One white panel of questions, the first one open. */
export function FaqList({ items }: { items: ReadonlyArray<FaqItem> }) {
  useOpenTargetedDetails();
  return (
    <div className="panel mt-9 px-1.5 py-1 sm:px-3 sm:py-2">
      {items.map((item, index) => (
        <details
          key={item.id}
          id={item.id}
          open={index === 0}
          className="group scroll-mt-6 border-b border-line px-3 py-4 last:border-b-0 sm:px-3.5 sm:py-[18px]"
        >
          <summary className="flex cursor-pointer list-none justify-between gap-4 rounded-md text-[17px] font-bold sm:text-lg [&::-webkit-details-marker]:hidden">
            {item.question}
            <span aria-hidden className="shrink-0 text-accent">
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">−</span>
            </span>
          </summary>
          <p className="mt-2.5 text-base leading-[1.6] text-soft">{renderAnswer(item.answer)}</p>
        </details>
      ))}
    </div>
  );
}
