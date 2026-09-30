/**
 * Keyboard focus ring for links and buttons. Sets the outline style
 * explicitly: Tailwind v4's width utilities read it from a variable that
 * `outline-none` would blank out.
 */
export const focusRing =
  "focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-hot";

/** Focuses the $5 URL field (after the browser has scrolled to #add). */
export const focusJudgeInput = () => {
  requestAnimationFrame(() => document.getElementById("judge-url")?.focus({ preventScroll: true }));
};

/** `/` or `/?page=3`: the board page a closed row goes back to. */
export const boardHref = (page: number): string => (page > 1 ? `/?page=${page}` : "/");
