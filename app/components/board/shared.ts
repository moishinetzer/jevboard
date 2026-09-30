/** Focuses the $5 URL field (after the browser has scrolled to #add). */
export const focusJudgeInput = () => {
  requestAnimationFrame(() => document.getElementById("judge-url")?.focus({ preventScroll: true }));
};

/** `/` or `/?page=3`: the board page a closed row goes back to. */
export const boardHref = (page: number): string => (page > 1 ? `/?page=${page}` : "/");
