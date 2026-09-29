import { Form, Link } from "react-router";
import { formatCount } from "~/lib/format";
import { type BoardFilters, focusRing, homeHref, SORT_TABS } from "./shared";

/** Sort tabs, docket search and category chips. Plain links + a GET form: works without JS, URLs are shareable. */
export function BoardControls({
  filters,
  categories,
}: {
  filters: BoardFilters;
  categories: ReadonlyArray<{ category: string; count: number }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SortTabs filters={filters} />
        <SearchBox filters={filters} />
      </div>
      {categories.length > 0 ? <CategoryChips filters={filters} categories={categories} /> : null}
    </div>
  );
}

function SortTabs({ filters }: { filters: BoardFilters }) {
  return (
    <nav aria-label="Sort the board" className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0 lg:pb-0">
      <ul className="flex w-max border-[3px] border-line bg-card shadow-[4px_4px_0_var(--shadow)]">
        {SORT_TABS.map((tab, index) => {
          const active = filters.sort === tab.sort;
          return (
            <li key={tab.sort} className={index > 0 ? "border-l-[3px] border-line" : ""}>
              <Link
                to={homeHref(filters, { sort: tab.sort })}
                preventScrollReset
                aria-current={active ? "page" : undefined}
                className={`block px-3.5 py-2 text-sm font-bold whitespace-nowrap uppercase transition-colors sm:px-4 ${
                  active ? "bg-ink text-paper" : "hover:bg-jev hover:text-[#111110]"
                } ${focusRing} focus-visible:-outline-offset-4`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SearchBox({ filters }: { filters: BoardFilters }) {
  return (
    <Form method="get" action="/" role="search" preventScrollReset className="flex w-full min-w-0 lg:w-[22rem]">
      {filters.sort !== "rank" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
      <label htmlFor="board-search" className="sr-only">
        Search the docket
      </label>
      <input
        id="board-search"
        key={filters.query}
        type="search"
        name="q"
        defaultValue={filters.query}
        maxLength={100}
        placeholder="Search the docket…"
        autoComplete="off"
        className="min-w-0 flex-1 border-[3px] border-r-0 border-line bg-card px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 focus:bg-jev/20"
      />
      <button type="submit" className={`btn px-4 py-2 text-sm shadow-none! ${focusRing}`}>
        <span aria-hidden>🔎</span>
        <span className="sr-only sm:not-sr-only">Search</span>
      </button>
    </Form>
  );
}

function CategoryChips({
  filters,
  categories,
}: {
  filters: BoardFilters;
  categories: ReadonlyArray<{ category: string; count: number }>;
}) {
  const total = categories.reduce((sum, item) => sum + item.count, 0);
  const chips = [{ category: "", count: total }, ...categories];
  return (
    <nav aria-label="Filter by category" className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {chips.map((chip) => {
          const active = filters.category === chip.category;
          return (
            <li key={chip.category || "all"}>
              <Link
                to={homeHref(filters, { category: chip.category })}
                preventScrollReset
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 border-2 px-2.5 py-1 text-xs font-bold whitespace-nowrap uppercase transition-transform hover:-translate-y-0.5 ${
                  active
                    ? "border-[#111110] bg-jev text-[#111110] shadow-[2px_2px_0_var(--shadow)]"
                    : "border-line bg-card text-ink"
                } ${focusRing}`}
              >
                {chip.category || "All categories"}
                <span className={`tabular text-[10px] ${active ? "" : "text-ink-soft"}`}>{formatCount(chip.count)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
