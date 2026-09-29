import { useEffect, useState } from "react";
import { focusRing } from "./shared";

/**
 * "Post to X" (a plain intent link, works without JS) plus a copy-link
 * button that appears once the page is interactive.
 */
export function ShareLinks({
  text,
  url,
  label,
  tone = "light",
}: {
  text: string;
  url: string;
  label: string;
  tone?: "light" | "dark";
}) {
  const [copied, setCopied] = useState(false);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const intent = `https://x.com/intent/post?${new URLSearchParams({ text, url }).toString()}`;
  const base = `inline-flex items-center gap-1.5 border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${focusRing}`;
  const look =
    tone === "dark"
      ? "border-[#fbf6e7] text-[#fbf6e7] hover:bg-jev hover:text-[#111110] hover:border-jev"
      : "border-line bg-card text-ink hover:bg-jev hover:text-[#111110]";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions): the X link still works.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <a href={intent} target="_blank" rel="noopener noreferrer" className={`${base} ${look}`}>
        <span aria-hidden>𝕏</span> {label}
      </a>
      {interactive ? (
        <button type="button" onClick={copy} className={`${base} ${look}`} aria-live="polite">
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      ) : null}
    </div>
  );
}
