import { useState } from "react";
import { JevFace } from "~/components/logo";
import { tierFor } from "~/lib/format";
import { entryPath } from "~/lib/site-key";
import { CopyButton } from "./copy-button";
import { ImageWithStandIn, Segmented } from "./controls";
import { badgePath } from "./links";
import { isHighScore } from "./share-copy";

type Theme = "light" | "dark";
type Style = "default" | "compact" | "big";

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
const STYLES = [
  { value: "default", label: "Standard" },
  { value: "compact", label: "Compact" },
  { value: "big", label: "Big" },
] as const;

/** "Embed your badge": live preview plus copy-paste Markdown and HTML. */
export function BadgeEmbed({
  siteKey,
  score,
  rank,
  total,
  label,
  origin,
}: {
  siteKey: string;
  score: number;
  rank: number;
  total: number;
  label: string;
  /** Absolute origin used in the snippets, e.g. https://jevboard.lol */
  origin: string;
}) {
  const [theme, setTheme] = useState<Theme>("light");
  const [style, setStyle] = useState<Style>("default");

  const params = new URLSearchParams();
  if (theme === "dark") params.set("theme", "dark");
  if (style !== "default") params.set("style", style);
  const query = params.toString() ? `?${params.toString()}` : "";

  const previewSrc = `${badgePath(siteKey)}${query}`;
  const badgeUrl = `${origin}${previewSrc}`;
  const pageUrl = `${origin}${entryPath(siteKey)}`;
  const alt = `Jev's verdict on ${siteKey} — Jevboard`;
  const markdown = `[![${alt}](${badgeUrl})](${pageUrl})`;
  const html = `<a href="${pageUrl}" target="_blank" rel="noopener"><img src="${badgeUrl.replaceAll("&", "&amp;")}" alt="${alt}"></a>`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Segmented legend="Theme" value={theme} options={THEMES} onChange={setTheme} />
        <Segmented legend="Size" value={style} options={STYLES} onChange={setStyle} />
      </div>

      <div
        className={`grid min-h-28 place-items-center border-2 border-dashed border-line p-6 ${
          theme === "dark" ? "bg-[#12110e]" : "bg-[#fbf6e7]"
        }`}
      >
        <ImageWithStandIn
          key={previewSrc}
          src={previewSrc}
          alt={alt}
          standIn={<BadgeStandIn score={score} rank={rank} total={total} label={label} theme={theme} style={style} />}
          imgClassName={`max-w-full ${style === "big" ? "" : "h-8 w-auto sm:h-10"}`}
        />
      </div>
      <p className="text-sm text-ink-soft">
        The badge updates itself after every retrial and links back to this verdict.{" "}
        {isHighScore(score)
          ? "Put it in your footer. Let it do the bragging."
          : `Embedding a ${score} takes guts. Jev respects guts.`}
      </p>

      <Snippet title="Markdown" hint="README, docs, GitHub profile" code={markdown} />
      <Snippet title="HTML" hint="Footer, landing page, anywhere" code={html} />
    </div>
  );
}

function Snippet({ title, hint, code }: { title: string; hint: string; code: string }) {
  return (
    <div className="border-2 border-line bg-paper-2">
      <div className="flex items-center justify-between gap-3 border-b-2 border-line px-3 py-1.5">
        <p className="text-xs font-bold uppercase tracking-wide">
          {title} <span className="font-normal normal-case tracking-normal text-ink-soft">· {hint}</span>
        </p>
        <CopyButton
          text={code}
          label="Copy"
          className="shrink-0 border-2 border-line bg-jev px-2 py-0.5 text-xs font-bold uppercase text-[#111110] hover:bg-jev-deep"
        />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** CSS look-alike of /badge/<siteKey>.svg, shown until (or instead of) the real SVG. */
function BadgeStandIn({
  score,
  rank,
  total,
  label,
  theme,
  style,
}: {
  score: number;
  rank: number;
  total: number;
  label: string;
  theme: Theme;
  style: Style;
}) {
  const tier = tierFor(score);
  const dark = theme === "dark";
  const frame = dark ? "border-[#f6f1e1] bg-[#1a1914] text-[#f6f1e1]" : "border-[#111110] bg-[#fffdf6] text-[#111110]";
  const tierStyle = { background: tier.color, color: tier.ink };

  if (style === "big") {
    return (
      <span className={`inline-flex w-[300px] max-w-full items-stretch border-2 ${frame}`}>
        <span className="flex flex-col items-center justify-center px-3 py-2" style={tierStyle}>
          <span className="font-display text-4xl leading-none">{score}</span>
          <span className="font-mono text-[10px] font-bold">/1000</span>
        </span>
        <span className="min-w-0 flex-1 px-3 py-2 leading-tight">
          <span className="flex items-center gap-1.5 font-display text-lg">
            <JevFace size={18} /> #{rank} of {total}
          </span>
          <span className="block font-mono text-[10px] font-bold uppercase">{tier.label}</span>
          <span className="block truncate font-mono text-[10px]">“{label}”</span>
        </span>
      </span>
    );
  }
  return (
    <span className={`inline-flex h-8 items-stretch border-2 font-mono text-sm font-bold sm:h-10 sm:text-base ${frame}`}>
      <span className="flex items-center gap-1.5 bg-[#111110] px-2 text-[#fbf6e7]">
        <JevFace size={18} />
        {style === "compact" ? null : "JEV SCORE"}
      </span>
      <span className="flex items-center px-2" style={tierStyle}>
        {style === "compact" ? `${score} · #${rank}` : `${score}/1000 · #${rank}`}
      </span>
    </span>
  );
}
