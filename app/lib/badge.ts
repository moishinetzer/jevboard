/**
 * Embeddable "JEV SCORE" badges (shields.io style), built as plain SVG strings.
 *
 * Pure and dependency-free so it runs anywhere (resource route, tests, scripts).
 * Text is measured with a Verdana advance-width table so the segments fit the
 * copy; every `<text>` also carries `textLength`, which keeps the layout exact
 * when the viewer falls back to a different font.
 */

import { tierFor } from "./format";

export const BADGE_THEMES = ["light", "dark"] as const;
export type BadgeTheme = (typeof BADGE_THEMES)[number];

export const BADGE_STYLES = ["default", "compact", "big"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];

export interface BadgeEntry {
  readonly siteKey: string;
  readonly score: number;
  readonly rank: number;
  /** Entries currently on the board ("#14 of 931"). */
  readonly total: number;
  /** Jev's hyphenated verdict label. */
  readonly label: string;
}

export interface BadgeOptions {
  readonly theme?: BadgeTheme | undefined;
  readonly style?: BadgeStyle | undefined;
  /** Absolute verdict-page URL. Makes the badge clickable when the SVG is opened directly. */
  readonly href?: string | undefined;
}

export const parseBadgeTheme = (value: string | null | undefined): BadgeTheme =>
  BADGE_THEMES.find((theme) => theme === value?.toLowerCase()) ?? "light";

export const parseBadgeStyle = (value: string | null | undefined): BadgeStyle =>
  BADGE_STYLES.find((style) => style === value?.toLowerCase()) ?? "default";

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Escapes text for XML attribute and element content. Characters XML 1.0
 * forbids outright (C0 controls other than tab/newline/CR, lone surrogates,
 * U+FFFE/U+FFFF) are dropped, because no escape makes them valid.
 */
export const escapeXml = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[&<>"']/g, (char) => XML_ENTITIES[char]!);

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/** Verdana advance widths in em (regular weight), the font shields.io badges are measured in. */
const VERDANA_EM: Record<string, number> = {
  " ": 0.352, "!": 0.394, '"': 0.46, "#": 0.818, $: 0.636, "%": 1.076, "&": 0.727, "'": 0.269,
  "(": 0.454, ")": 0.454, "*": 0.636, "+": 0.818, ",": 0.364, "-": 0.454, ".": 0.364, "/": 0.454,
  ":": 0.454, ";": 0.454, "<": 0.818, "=": 0.818, ">": 0.818, "?": 0.545, "@": 1.0, "[": 0.454,
  "\\": 0.454, "]": 0.454, "^": 0.818, _: 0.636, "`": 0.636, "{": 0.636, "|": 0.454, "}": 0.636,
  "~": 0.818, "·": 0.364, "…": 0.818, "“": 0.46, "”": 0.46, "‘": 0.269, "’": 0.269, "—": 1.0, "–": 0.636,
  A: 0.684, B: 0.686, C: 0.698, D: 0.771, E: 0.632, F: 0.575, G: 0.775, H: 0.751, I: 0.421, J: 0.455,
  K: 0.693, L: 0.557, M: 0.843, N: 0.748, O: 0.787, P: 0.603, Q: 0.787, R: 0.695, S: 0.684, T: 0.616,
  U: 0.732, V: 0.684, W: 0.989, X: 0.685, Y: 0.615, Z: 0.685,
  a: 0.601, b: 0.623, c: 0.521, d: 0.623, e: 0.596, f: 0.352, g: 0.623, h: 0.633, i: 0.274, j: 0.344,
  k: 0.592, l: 0.274, m: 0.973, n: 0.633, o: 0.607, p: 0.623, q: 0.623, r: 0.427, s: 0.521, t: 0.394,
  u: 0.633, v: 0.592, w: 0.818, x: 0.592, y: 0.592, z: 0.525,
};
const DIGIT_EM = 0.636;
const FALLBACK_EM = 0.62;
const BOLD_FACTOR = 1.1;

const isWide = (codePoint: number): boolean =>
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  codePoint >= 0x1f300;

/** Width of one character in em (Verdana metrics, sensible fallbacks for everything else). */
const charEm = (char: string): number => {
  if (char >= "0" && char <= "9") return DIGIT_EM;
  const known = VERDANA_EM[char];
  if (known !== undefined) return known;
  return isWide(char.codePointAt(0) ?? 0) ? 1 : FALLBACK_EM;
};

/** Estimated rendered width in px of `text` in Verdana at `fontSize`. */
export const textWidth = (text: string, fontSize = 11, bold = false): number => {
  let em = 0;
  for (const char of text) em += charEm(char);
  return em * fontSize * (bold ? BOLD_FACTOR : 1);
};

/** Monospace fonts are ~0.6em per glyph. */
const monoWidth = (text: string, fontSize: number): number => [...text].length * fontSize * 0.6;

/** Cuts `text` to at most `maxChars` code points, ending with "…" when shortened. */
export const truncate = (text: string, maxChars: number): string => {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, Math.max(1, maxChars - 1)).join("").trimEnd()}…`;
};

const round = (n: number): number => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const INK = "#111110";
const PAPER = "#fbf6e7";
const JEV = "#ffd400";
const NOT_JUDGED = "#9a968a";

interface Palette {
  readonly frame: string;
  readonly shadow: string;
  readonly labelBg: string;
  readonly labelInk: string;
  readonly cardBg: string;
  readonly cardInk: string;
  readonly cardSoft: string;
}

const PALETTES: Record<BadgeTheme, Palette> = {
  light: {
    frame: INK,
    shadow: INK,
    labelBg: INK,
    labelInk: JEV,
    cardBg: "#fffdf6",
    cardInk: INK,
    cardSoft: "#4a463d",
  },
  dark: {
    frame: "#f6f1e1",
    shadow: "#000000",
    labelBg: "#1a1914",
    labelInk: JEV,
    cardBg: "#1a1914",
    cardInk: "#f6f1e1",
    cardSoft: "#b9b2a0",
  },
};

const FONT_SANS = "Verdana,Geneva,'DejaVu Sans',sans-serif";
const FONT_DISPLAY = "Anton,Impact,'Arial Narrow Bold','Helvetica Neue',sans-serif";
const FONT_MONO = "'JetBrains Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace";

/** Jev's face (crown, monocle, frown) scaled into a `size`×`size` box at (x, y). */
const jevFace = (x: number, y: number, size: number): string => {
  const s = round(size / 64);
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M18 14 L24 4 L32 12 L40 4 L46 14 Z" fill="${JEV}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="36" r="24" fill="${JEV}" stroke="${INK}" stroke-width="4.5"/><circle cx="23" cy="33" r="4.5" fill="${INK}"/><circle cx="41" cy="33" r="8" fill="#fffdf6" stroke="${INK}" stroke-width="3.5"/><circle cx="41" cy="33" r="3.6" fill="${INK}"/><path d="M23 46 Q32 42 41 46" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></g>`;
};

interface TextAttrs {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fill: string;
  readonly family?: string;
  readonly weight?: "bold";
  readonly anchor?: "start" | "middle" | "end";
  readonly spacing?: number;
  /**
   * Pins the rendered width (SVG `textLength`) to the measured estimate so a
   * fallback font can't push text out of its segment. Omit for display type
   * that already has room to spare.
   */
  readonly length?: number;
}

const text = (content: string, attrs: TextAttrs): string => {
  const parts = [
    `x="${round(attrs.x)}"`,
    `y="${round(attrs.y)}"`,
    `fill="${attrs.fill}"`,
    `font-family="${attrs.family ?? FONT_SANS}"`,
    `font-size="${attrs.size}"`,
    attrs.weight ? `font-weight="${attrs.weight}"` : "",
    attrs.anchor && attrs.anchor !== "start" ? `text-anchor="${attrs.anchor}"` : "",
    attrs.spacing ? `letter-spacing="${attrs.spacing}"` : "",
    attrs.length !== undefined ? `textLength="${round(attrs.length)}" lengthAdjust="spacingAndGlyphs"` : "",
  ].filter(Boolean);
  return `<text ${parts.join(" ")}>${escapeXml(content)}</text>`;
};

const wrapSvg = (width: number, height: number, title: string, body: string, href: string | undefined): string => {
  const safeTitle = escapeXml(title);
  const inner = href ? `<a href="${escapeXml(href)}" target="_blank">${body}</a>` : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeTitle}"><title>${safeTitle}</title>${inner}</svg>`;
};

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

const SHADOW = 2;
const PAD = 7;

/** Two-segment shields-style pill: [face + left | right]. */
const pill = (options: {
  readonly left: string;
  readonly right: string;
  readonly rightBg: string;
  readonly rightInk: string;
  readonly palette: Palette;
  readonly title: string;
  readonly href: string | undefined;
  readonly height: number;
}): string => {
  const { palette, height } = options;
  const fontSize = height >= 22 ? 11 : 10;
  const iconSize = height - 6;
  const leftTextWidth = options.left ? textWidth(options.left, fontSize, true) : 0;
  const rightTextWidth = textWidth(options.right, fontSize, true);
  const iconSpace = iconSize + (options.left ? 5 : 0);
  const leftWidth = Math.ceil(PAD - 2 + iconSpace + leftTextWidth + (options.left ? PAD : PAD - 2));
  const rightWidth = Math.ceil(PAD + rightTextWidth + PAD);
  const innerWidth = leftWidth + rightWidth;
  const baseline = round(height / 2 + fontSize * 0.36);

  const body = [
    `<rect x="${SHADOW}" y="${SHADOW}" width="${innerWidth}" height="${height}" fill="${palette.shadow}"/>`,
    `<rect width="${leftWidth}" height="${height}" fill="${palette.labelBg}"/>`,
    `<rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${options.rightBg}"/>`,
    `<rect x="0.75" y="0.75" width="${innerWidth - 1.5}" height="${height - 1.5}" fill="none" stroke="${palette.frame}" stroke-width="1.5"/>`,
    `<path d="M${leftWidth} 0V${height}" stroke="${palette.frame}" stroke-width="1.5"/>`,
    jevFace(PAD - 2, 3, iconSize),
    options.left
      ? text(options.left, {
          x: PAD - 2 + iconSpace,
          y: baseline,
          size: fontSize,
          fill: palette.labelInk,
          weight: "bold",
          length: leftTextWidth,
        })
      : "",
    text(options.right, {
      x: leftWidth + PAD,
      y: baseline,
      size: fontSize,
      fill: options.rightInk,
      weight: "bold",
      length: rightTextWidth,
    }),
  ].join("");

  return wrapSvg(innerWidth + SHADOW, height + SHADOW, options.title, body, options.href);
};

export const BIG_BADGE_SIZE = { width: 300, height: 104 } as const;

/** Small card: header strip, tier-coloured score block, rank + tier, verdict label footer. */
const card = (options: {
  readonly palette: Palette;
  readonly title: string;
  readonly href: string | undefined;
  readonly scoreBg: string;
  readonly scoreInk: string;
  readonly score: string;
  /** Small line under the score, e.g. "/1000". */
  readonly scoreUnit?: string;
  readonly headline: string;
  readonly subline: string;
  readonly caption: string;
}): string => {
  const { palette } = options;
  const innerW = BIG_BADGE_SIZE.width - 3;
  const innerH = BIG_BADGE_SIZE.height - 3;
  const header = 22;
  const footer = 20;
  const scoreW = 100;
  const infoX = scoreW + 12;
  const infoW = innerW - infoX - 10;
  const bodyBottom = innerH - footer;

  // Display type is sized against Verdana Bold (the widest likely fallback), so it always fits.
  const headlineSize = Math.min(24, Math.floor(infoW / Math.max(1, textWidth(options.headline, 1, true))));
  const scoreSize = options.score.length > 3 ? 36 : 42;
  const subline = truncate(options.subline, 26);
  const sublineWidth = textWidth(subline, 9.5, true);
  const captionSize = 9;
  const caption = truncate(options.caption, Math.floor((innerW - 16) / (captionSize * 0.6)));

  const body = [
    `<rect x="3" y="3" width="${innerW}" height="${innerH}" fill="${palette.shadow}"/>`,
    `<rect width="${innerW}" height="${innerH}" fill="${palette.cardBg}"/>`,
    `<rect width="${innerW}" height="${header}" fill="${INK}"/>`,
    jevFace(6, 3, 16),
    text("RATED BY JEV", { x: 28, y: 15, size: 10, fill: JEV, weight: "bold", length: textWidth("RATED BY JEV", 10, true) }),
    text("JEVBOARD", { x: innerW - 8, y: 15, size: 9, fill: PAPER, weight: "bold", anchor: "end", length: textWidth("JEVBOARD", 9, true) }),
    `<rect y="${header}" width="${scoreW}" height="${bodyBottom - header}" fill="${options.scoreBg}"/>`,
    `<path d="M${scoreW} ${header}V${bodyBottom}M0 ${header}H${innerW}M0 ${bodyBottom}H${innerW}" stroke="${palette.frame}" stroke-width="1.5"/>`,
    text(options.score, {
      x: scoreW / 2,
      y: header + (scoreSize > 40 ? 40 : 37),
      size: scoreSize,
      fill: options.scoreInk,
      family: FONT_DISPLAY,
      anchor: "middle",
    }),
    options.scoreUnit
      ? text(options.scoreUnit, {
          x: scoreW / 2,
          y: bodyBottom - 5,
          size: 9,
          fill: options.scoreInk,
          family: FONT_MONO,
          weight: "bold",
          anchor: "middle",
          length: monoWidth(options.scoreUnit, 9),
        })
      : "",
    text(options.headline, { x: infoX, y: header + 27, size: headlineSize, fill: palette.cardInk, family: FONT_DISPLAY }),
    text(subline, { x: infoX, y: header + 45, size: 9.5, fill: palette.cardSoft, weight: "bold", length: Math.min(infoW, sublineWidth) }),
    text(caption, { x: 8, y: innerH - 6.5, size: captionSize, fill: palette.cardInk, family: FONT_MONO, weight: "bold", length: monoWidth(caption, captionSize) }),
    `<rect x="0.75" y="0.75" width="${innerW - 1.5}" height="${innerH - 1.5}" fill="none" stroke="${palette.frame}" stroke-width="1.5"/>`,
  ].join("");

  return wrapSvg(BIG_BADGE_SIZE.width, BIG_BADGE_SIZE.height, options.title, body, options.href);
};

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Badge for a judged site. */
export const buildBadge = (entry: BadgeEntry, options: BadgeOptions = {}): string => {
  const palette = PALETTES[options.theme ?? "light"];
  const tier = tierFor(entry.score);
  const title = `Rated ${entry.score}/1000 by Jev · #${entry.rank} of ${entry.total} on Jevboard (${entry.siteKey})`;

  switch (options.style ?? "default") {
    case "compact":
      return pill({
        left: "",
        right: `${entry.score} · #${entry.rank}`,
        rightBg: tier.color,
        rightInk: tier.ink,
        palette,
        title,
        href: options.href,
        height: 20,
      });
    case "big":
      return card({
        palette,
        title,
        href: options.href,
        scoreBg: tier.color,
        scoreInk: tier.ink,
        score: String(entry.score),
        scoreUnit: "/1000",
        headline: `#${entry.rank} of ${entry.total}`,
        subline: tier.label.toUpperCase(),
        caption: `“${entry.label}”`,
      });
    default:
      return pill({
        left: "JEV SCORE",
        right: `${entry.score}/1000 · #${entry.rank}`,
        rightBg: tier.color,
        rightInk: tier.ink,
        palette,
        title,
        href: options.href,
        height: 22,
      });
  }
};

/** Grey badge for a site Jev hasn't judged (yet). Served with 200 so embeds never break. */
export const buildNotJudgedBadge = (siteKey: string, options: BadgeOptions = {}): string => {
  const palette = PALETTES[options.theme ?? "light"];
  const title = `${siteKey || "This site"} has not been judged by Jev yet`;

  switch (options.style ?? "default") {
    case "compact":
      return pill({ left: "", right: "not judged", rightBg: NOT_JUDGED, rightInk: INK, palette, title, href: options.href, height: 20 });
    case "big":
      return card({
        palette,
        title,
        href: options.href,
        scoreBg: NOT_JUDGED,
        scoreInk: INK,
        score: "???",
        headline: "Not judged",
        subline: "JEV HASN'T SEEN THIS ONE",
        caption: "Pay $5. Get judged by Jev.",
      });
    default:
      return pill({
        left: "JEV SCORE",
        right: "not judged yet",
        rightBg: NOT_JUDGED,
        rightInk: INK,
        palette,
        title,
        href: options.href,
        height: 22,
      });
  }
};
