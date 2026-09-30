/**
 * Embeddable jevboard badges ("jevboard | #3 · 783", shields.io style), built
 * as plain SVG strings.
 *
 * Pure and dependency-free so it runs anywhere (resource route, tests, scripts).
 * Text is measured with a Verdana advance-width table so the segments fit the
 * copy; every `<text>` also carries `textLength`, which keeps the layout exact
 * when the viewer falls back to a different font.
 */

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

/** Cuts `text` to at most `maxChars` code points, ending with "…" when shortened. */
export const truncate = (text: string, maxChars: number): string => {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, Math.max(1, maxChars - 1)).join("").trimEnd()}…`;
};

/** Truncates `text` until it measures at most `maxWidth` px. */
const fitText = (text: string, maxWidth: number, fontSize: number, bold = false): string => {
  let max = [...text].length;
  let fitted = text;
  while (max > 1 && textWidth(fitted, fontSize, bold) > maxWidth) fitted = truncate(text, --max);
  return fitted;
};

const round = (n: number): number => Math.round(n * 10) / 10;
const scale = (n: number): number => Math.round(n * 10_000) / 10_000;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const FACE_INK = "#1d1b16";
const JEV = "#ffd400";

type Medal = "gold" | "silver" | "bronze";

const medalFor = (rank: number): Medal | null =>
  rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;

const CROWN_FILL: Record<Medal, string> = { gold: "#fff4b8", silver: "#c9ced6", bronze: "#d0894a" };

interface Tint {
  readonly bg: string;
  readonly line: string;
}

interface Palette {
  /** Card / label background. */
  readonly paper: string;
  readonly ink: string;
  readonly soft: string;
  readonly line: string;
  readonly pill: string;
  readonly accent: string;
  /** Text on the accent. */
  readonly onAccent: string;
  readonly medal: Record<Medal, Tint>;
}

const PALETTES: Record<BadgeTheme, Palette> = {
  light: {
    paper: "#fcfaf3",
    ink: "#1d1b16",
    soft: "#6b6658",
    line: "#ebe5d4",
    pill: "#f3eedf",
    accent: "#b45309",
    onAccent: "#ffffff",
    medal: {
      gold: { bg: "#fff7d1", line: "#f3d774" },
      silver: { bg: "#f4f5f7", line: "#d9dde3" },
      bronze: { bg: "#fcf0e4", line: "#ebc7a3" },
    },
  },
  dark: {
    paper: "#1c1b16",
    ink: "#f4f1e6",
    soft: "#a9a393",
    line: "#34312a",
    pill: "#221f18",
    accent: "#f5b93a",
    onAccent: "#14130f",
    // The site's translucent medal tints, pre-blended onto the dark card.
    medal: {
      gold: { bg: "#302c14", line: "#6b5c0e" },
      silver: { bg: "#2a2925", line: "#505150" },
      bronze: { bg: "#2e261b", line: "#60452a" },
    },
  },
};

const FONT_SANS = "Verdana,Geneva,'DejaVu Sans',sans-serif";
const FONT_DISPLAY = "'Bricolage Grotesque','Helvetica Neue',Arial,sans-serif";

/** Jev's face (crown, brows, monocle) scaled into a `size`×`size` box at (x, y). */
const jevFace = (x: number, y: number, size: number): string =>
  `<g transform="translate(${round(x)} ${round(y)}) scale(${scale(size / 64)})" stroke="${FACE_INK}" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M18 14 L24 4 L32 12 L40 4 L46 14 Z" fill="${JEV}" stroke-width="3.5"/>` +
  `<circle cx="32" cy="36" r="24" fill="${JEV}" stroke-width="4"/>` +
  `<circle cx="23" cy="33" r="4" fill="${FACE_INK}" stroke="none"/>` +
  `<circle cx="41" cy="33" r="7.5" fill="#fffdf6" stroke-width="3.5"/>` +
  `<circle cx="41" cy="33" r="3.2" fill="${FACE_INK}" stroke="none"/>` +
  `<path d="M17 26 L28 28M35 25 L47 23" fill="none" stroke-width="3.5"/>` +
  `<path d="M23 46 Q32 42 41 46" fill="none" stroke-width="4"/>` +
  `</g>`;

/** The top-three crown, `width` px wide, top-left at (x, y). */
const crown = (x: number, y: number, width: number, medal: Medal): string =>
  `<g transform="translate(${round(x)} ${round(y)}) scale(${scale(width / 26)})"><path d="M2 16 L4 4 L9 10 L13 2 L17 10 L22 4 L24 16 Z" fill="${CROWN_FILL[medal]}" stroke="${FACE_INK}" stroke-width="2" stroke-linejoin="round"/></g>`;

interface TextAttrs {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fill: string;
  readonly family?: string;
  readonly weight?: "bold" | "800";
  readonly anchor?: "start" | "middle" | "end";
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

const PAD = 7;
const RADIUS = 4;

/** Two-segment shields-style pill: [face + label | value], rounded, with a hairline outline. */
const pill = (options: {
  readonly label: string;
  readonly value: string;
  readonly valueBg: string;
  readonly valueInk: string;
  readonly palette: Palette;
  readonly title: string;
  readonly href: string | undefined;
  readonly height: number;
}): string => {
  const { palette, height } = options;
  const fontSize = 11;
  const iconSize = height - 6;
  const labelWidth = options.label ? textWidth(options.label, fontSize, true) : 0;
  const valueWidth = textWidth(options.value, fontSize, true);
  const iconSpace = iconSize + (options.label ? 5 : 0);
  const leftWidth = Math.ceil(PAD - 2 + iconSpace + labelWidth + (options.label ? PAD : PAD - 2));
  const rightWidth = Math.ceil(PAD + valueWidth + PAD);
  const width = leftWidth + rightWidth;
  const baseline = round(height / 2 + fontSize * 0.36);
  const r = RADIUS;

  const body = [
    `<rect width="${width}" height="${height}" rx="${r}" fill="${palette.pill}"/>`,
    `<path d="M${leftWidth} 0H${width - r}A${r} ${r} 0 0 1 ${width} ${r}V${height - r}A${r} ${r} 0 0 1 ${width - r} ${height}H${leftWidth}Z" fill="${options.valueBg}"/>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${r - 0.5}" fill="none" stroke="${palette.line}"/>`,
    jevFace(PAD - 2, 3, iconSize),
    options.label
      ? text(options.label, { x: PAD - 2 + iconSpace, y: baseline, size: fontSize, fill: palette.ink, weight: "bold", length: labelWidth })
      : "",
    text(options.value, { x: leftWidth + PAD, y: baseline, size: fontSize, fill: options.valueInk, weight: "bold", length: valueWidth }),
  ].join("");

  return wrapSvg(width, height, options.title, body, options.href);
};

export const BIG_BADGE_SIZE = { width: 300, height: 104 } as const;

/** Small card: face + wordmark and a rank chip on top; site, caption and the big score below. */
const card = (options: {
  readonly palette: Palette;
  readonly title: string;
  readonly href: string | undefined;
  readonly chip: string;
  readonly medal: Medal | null;
  readonly score: string;
  readonly scoreInk: string;
  readonly site: string;
  readonly caption: string;
}): string => {
  const { palette } = options;
  const { width, height } = BIG_BADGE_SIZE;
  const inset = 14;

  const chipSize = 10;
  const chipText = textWidth(options.chip, chipSize, true);
  const crownWidth = options.medal ? 14 : 0;
  const chipW = Math.ceil(10 + crownWidth + (options.medal ? 5 : 0) + chipText + 10);
  const chipH = 22;
  const chipX = width - inset - chipW;
  const chipY = 12;
  const tint = options.medal ? palette.medal[options.medal] : { bg: palette.pill, line: palette.line };

  // Display type is sized against Verdana Bold (the widest likely fallback), so it always fits.
  const scoreSize = 44;
  const scoreWidth = textWidth(options.score, scoreSize, true);
  const infoWidth = width - inset * 2 - scoreWidth - 12;
  const site = fitText(options.site, infoWidth, 12, true);
  const caption = fitText(options.caption, infoWidth, 10);

  const body = [
    `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="10" fill="${palette.paper}" stroke="${palette.line}" stroke-width="1.5"/>`,
    jevFace(inset - 2, 12, 22),
    text("jevboard", { x: inset + 25, y: 28, size: 14, fill: palette.ink, family: FONT_DISPLAY, weight: "bold", length: textWidth("jevboard", 14, true) }),
    `<rect x="${chipX + 0.5}" y="${chipY + 0.5}" width="${chipW - 1}" height="${chipH - 1}" rx="${chipH / 2}" fill="${tint.bg}" stroke="${tint.line}"/>`,
    options.medal ? crown(chipX + 10, chipY + 6, crownWidth, options.medal) : "",
    text(options.chip, {
      x: chipX + 10 + crownWidth + (options.medal ? 5 : 0),
      y: chipY + 15,
      size: chipSize,
      fill: palette.ink,
      weight: "bold",
      length: chipText,
    }),
    text(site, { x: inset, y: 74, size: 12, fill: palette.ink, weight: "bold", length: textWidth(site, 12, true) }),
    text(caption, { x: inset, y: 90, size: 10, fill: palette.soft, length: textWidth(caption, 10) }),
    text(options.score, {
      x: width - inset,
      y: 90,
      size: scoreSize,
      fill: options.scoreInk,
      family: FONT_DISPLAY,
      weight: "800",
      anchor: "end",
    }),
  ].join("");

  return wrapSvg(width, height, options.title, body, options.href);
};

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** Badge for a ranked site: "jevboard | #14 · 812". */
export const buildBadge = (entry: BadgeEntry, options: BadgeOptions = {}): string => {
  const palette = PALETTES[options.theme ?? "light"];
  const title = `${entry.siteKey} is #${entry.rank} of ${entry.total} on jevboard, with a score of ${entry.score}`;
  const value = `#${entry.rank} · ${entry.score}`;
  const shared = { valueBg: palette.accent, valueInk: palette.onAccent, palette, title, href: options.href };

  switch (options.style ?? "default") {
    case "compact":
      return pill({ ...shared, label: "", value, height: 20 });
    case "big":
      return card({
        palette,
        title,
        href: options.href,
        chip: `#${entry.rank} on the board`,
        medal: medalFor(entry.rank),
        score: String(entry.score),
        scoreInk: palette.accent,
        site: entry.siteKey,
        caption: "Ranked by Jev",
      });
    default:
      return pill({ ...shared, label: "jevboard", value, height: 20 });
  }
};

/** Muted badge for a site Jev hasn't ranked (yet). Served with 200 so embeds never break. */
export const buildNotJudgedBadge = (siteKey: string, options: BadgeOptions = {}): string => {
  const palette = PALETTES[options.theme ?? "light"];
  const title = `${siteKey || "This site"} is not on jevboard yet`;
  const shared = { valueBg: palette.line, valueInk: palette.soft, palette, title, href: options.href };

  switch (options.style ?? "default") {
    case "compact":
      return pill({ ...shared, label: "", value: "not ranked", height: 20 });
    case "big":
      return card({
        palette,
        title,
        href: options.href,
        chip: "Not ranked yet",
        medal: null,
        score: "?",
        scoreInk: palette.soft,
        site: siteKey || "This site",
        caption: "Get ranked by Jev for $5.",
      });
    default:
      return pill({ ...shared, label: "jevboard", value: "not ranked yet", height: 20 });
  }
};
