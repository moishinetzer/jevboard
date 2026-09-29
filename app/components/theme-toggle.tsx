import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "jev-theme";

/**
 * Inline script that runs before paint so the stored theme never flashes.
 * Falls back to the OS preference when nothing (or nothing readable) is stored.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`;

const currentTheme = (): Theme => {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="slab-sm grid size-10 place-items-center text-lg"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title="Toggle theme"
    >
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
