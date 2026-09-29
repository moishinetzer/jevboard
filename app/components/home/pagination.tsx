import { Link } from "react-router";
import { type BoardFilters, focusRing, homeHref } from "./shared";

/** Page numbers to show: first, last, and a window around the current page, with gaps as `null`. */
const pageWindow = (current: number, count: number): ReadonlyArray<number | null> => {
  const wanted = new Set([1, count, current - 1, current, current + 1].filter((page) => page >= 1 && page <= count));
  const pages = [...wanted].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const page of pages) {
    const previous = out[out.length - 1];
    if (typeof previous === "number" && page - previous > 1) out.push(null);
    out.push(page);
  }
  return out;
};

export function Pagination({ filters, total, pageSize }: { filters: BoardFilters; total: number; pageSize: number }) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  if (count <= 1) return null;
  const current = Math.min(filters.page, count);
  const step = `inline-flex min-w-11 items-center justify-center border-[3px] border-line px-3 py-2 text-sm font-bold uppercase ${focusRing}`;

  return (
    <nav aria-label="Board pages" className="mt-6 flex flex-wrap items-center justify-between gap-3">
      {current > 1 ? (
        <Link to={homeHref(filters, { page: current - 1 })} rel="prev" className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}>
          ← Prev
        </Link>
      ) : (
        <span className="btn btn-ghost px-4 py-2 text-sm opacity-40 shadow-none!" aria-hidden>
          ← Prev
        </span>
      )}

      <ol className="flex flex-wrap items-center gap-1.5">
        {pageWindow(current, count).map((page, index) =>
          page === null ? (
            <li key={`gap-${index}`} className="px-1 font-mono text-ink-soft" aria-hidden>
              …
            </li>
          ) : (
            <li key={page}>
              {page === current ? (
                <span aria-current="page" className={`${step} bg-ink text-paper`}>
                  <span className="sr-only">Page </span>
                  {page}
                </span>
              ) : (
                <Link to={homeHref(filters, { page })} className={`${step} bg-card hover:bg-jev hover:text-[#111110]`}>
                  <span className="sr-only">Page </span>
                  {page}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>

      {current < count ? (
        <Link to={homeHref(filters, { page: current + 1 })} rel="next" className={`btn btn-ghost px-4 py-2 text-sm ${focusRing}`}>
          Next →
        </Link>
      ) : (
        <span className="btn btn-ghost px-4 py-2 text-sm opacity-40 shadow-none!" aria-hidden>
          Next →
        </span>
      )}
    </nav>
  );
}
