import { useEffect } from "react";
import { Link } from "react-router";
import { focusRing } from "../shared";
import type { FaqGroup } from "./content";

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

export function FaqList({ groups }: { groups: ReadonlyArray<FaqGroup> }) {
  useOpenTargetedDetails();
  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-32">
          <h2 id={`${group.id}-title`} className="border-b-[3px] border-line pb-2 font-display text-4xl uppercase">
            {group.title}
          </h2>
          <div className="mt-5 flex flex-col gap-3">
            {group.items.map((item) => (
              <details key={item.id} id={item.id} className="group slab-sm scroll-mt-32 open:bg-jev/10">
                <summary
                  className={`flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3.5 text-lg font-bold sm:px-5 [&::-webkit-details-marker]:hidden ${focusRing} focus-visible:-outline-offset-4`}
                >
                  <span>{item.question}</span>
                  <span
                    className="mt-0.5 grid size-7 shrink-0 place-items-center border-2 border-line bg-card transition-transform group-open:rotate-45 group-open:bg-jev group-open:text-[#111110]"
                    aria-hidden
                  >
                    <svg viewBox="0 0 12 12" className="size-3">
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
                    </svg>
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-5 sm:px-5">
                  {item.answer.map((paragraph, index) => (
                    <p key={index} className={index === 0 ? "text-lg font-medium" : "text-ink-soft"}>
                      {paragraph}
                    </p>
                  ))}
                  {item.links && item.links.length > 0 ? (
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold">
                      {item.links.map((link) =>
                        link.to.startsWith("#") ? (
                          <a key={link.to} href={link.to} className={`underline decoration-2 underline-offset-2 hover:text-hot ${focusRing}`}>
                            {link.label} →
                          </a>
                        ) : (
                          <Link key={link.to} to={link.to} className={`underline decoration-2 underline-offset-2 hover:text-hot ${focusRing}`}>
                            {link.label} →
                          </Link>
                        ),
                      )}
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
