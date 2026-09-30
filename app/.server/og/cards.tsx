/**
 * Share-card layouts for satori (1200×630). Satori rules: every element with
 * more than one child needs `display: flex`, only inline styles, and only the
 * fonts registered in ./fonts (display 700/800, sans 500/700).
 */
import type { CSSProperties } from "react";
import { truncate } from "~/lib/badge";
import { formatCount } from "~/lib/format";
import { JEV_FACE_DATA_URI } from "./face";
import { OG_FONT } from "./fonts";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const PAPER = "#fcfaf3";
const INK = "#1d1b16";
const SOFT = "#6b6658";
const LINE = "#ebe5d4";
const PILL = "#f3eedf";
const ACCENT = "#b45309";

const PAD_Y = 56;
const PAD_X = 64;
const CONTENT_WIDTH = OG_WIDTH - PAD_X * 2;

type Medal = "gold" | "silver" | "bronze";

const medalFor = (rank: number): Medal | null =>
  rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : null;

const MEDAL: Record<Medal, { readonly crown: string; readonly bg: string; readonly line: string }> = {
  gold: { crown: "#fff4b8", bg: "#fff7d1", line: "#f3d774" },
  silver: { crown: "#c9ced6", bg: "#f4f5f7", line: "#d9dde3" },
  bronze: { crown: "#d0894a", bg: "#fcf0e4", line: "#ebc7a3" },
};

const row = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", alignItems: "center", ...style });
const col = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", flexDirection: "column", ...style });

/** Letter spacing in px for an `em` value (satori is happiest with plain numbers). */
const em = (size: number, value: number): number => Math.round(size * value * 100) / 100;

/**
 * Emoji would need a remote asset fetch at render time (disabled), so drop
 * them (and their joiners/variation selectors) instead of drawing tofu.
 */
export const cardText = (text: string): string =>
  text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

function Face({ size }: { size: number }) {
  return <img src={JEV_FACE_DATA_URI} width={size} height={size} style={{ width: size, height: size }} />;
}

function Crown({ medal, width }: { medal: Medal; width: number }) {
  const height = Math.round((width * 24) / 34);
  return (
    <svg width={width} height={height} viewBox="0 0 26 18">
      <path
        d="M2 16 L4 4 L9 10 L13 2 L17 10 L22 4 L24 16 Z"
        fill={MEDAL[medal].crown}
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Jev's face + the lowercase "jevboard" wordmark. */
function Brand() {
  return (
    <div style={row({ gap: 12 })}>
      <Face size={52} />
      <div style={{ display: "flex", fontFamily: OG_FONT.display, fontWeight: 700, fontSize: 36, lineHeight: 1, letterSpacing: em(36, -0.02) }}>
        jevboard
      </div>
    </div>
  );
}

/** Rounded pill, medal-tinted with a crown for the top three. */
function Pill({ medal, children }: { medal: Medal | null; children: string }) {
  const tint = medal ? MEDAL[medal] : { bg: PILL, line: LINE };
  return (
    <div
      style={row({
        gap: 10,
        padding: medal ? "8px 20px 8px 16px" : "8px 20px",
        borderRadius: 999,
        border: `2.5px solid ${tint.line}`,
        backgroundColor: tint.bg,
        fontWeight: 700,
        fontSize: 26,
        lineHeight: 1.2,
        color: INK,
      })}
    >
      {medal ? <Crown medal={medal} width={34} /> : null}
      <span>{children}</span>
    </div>
  );
}

function Footer({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", marginTop: 34, paddingTop: 22, borderTop: `1.5px solid ${LINE}`, fontSize: 22, fontWeight: 500, color: SOFT }}>
      {children}
    </div>
  );
}

const TAGLINE = "Think you're #1? Prove it for $5.";

/** Rough Bricolage Grotesque 800 advance widths in em (tight tracking included). */
const DISPLAY_EM = 0.56;
const DIGIT_EM = 0.56;

// ---------------------------------------------------------------------------
// Verdict card: /og/<siteKey>.png
// ---------------------------------------------------------------------------

export interface EntryCardProps {
  readonly siteKey: string;
  /** The business or product name, as it presents itself. */
  readonly name: string;
  readonly score: number;
  readonly rank: number;
  /** What the business does, in Jev's words. */
  readonly tldr: string;
}

const NAME_MAX = 72;
const NAME_MIN = 40;
const SCORE_SIZE = 168;
const GAP = 40;

/**
 * Largest name size (≤ 72px) whose text fits in two lines of `width`. Words
 * are wrapped greedily with an average glyph width, which is close enough for
 * a display face; `lineClamp` catches whatever the estimate misses.
 */
const fitName = (name: string, width: number): number => {
  const words = name.split(" ").map((word) => [...word].length);
  for (let size = NAME_MAX; size > NAME_MIN; size -= 4) {
    const perLine = Math.max(1, Math.floor(width / (size * DISPLAY_EM)));
    let lines = 1;
    let used = 0;
    for (const length of words) {
      if (used > 0 && used + 1 + length <= perLine) {
        used += 1 + length;
        continue;
      }
      if (used > 0) lines++;
      // An over-long word (a bare domain) breaks across lines.
      const extra = Math.ceil(length / perLine) - 1;
      lines += extra;
      used = length - extra * perLine;
    }
    if (lines <= 2) return size;
  }
  return NAME_MIN;
};

export function EntryCard(props: EntryCardProps) {
  const medal = medalFor(props.rank);
  const score = String(props.score);
  const scoreWidth = [...score].length * SCORE_SIZE * DIGIT_EM;
  const leftWidth = Math.min(780, CONTENT_WIDTH - GAP - scoreWidth);
  const name = truncate(cardText(props.name) || cardText(props.siteKey), 64);
  const nameSize = fitName(name, leftWidth);
  const tldr = truncate(cardText(props.tldr), 200);

  return (
    <div
      style={col({
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: `${PAD_Y}px ${PAD_X}px`,
        backgroundColor: PAPER,
        color: INK,
        fontFamily: OG_FONT.sans,
      })}
    >
      <div style={row({ justifyContent: "space-between" })}>
        <Brand />
        <Pill medal={medal}>{`#${formatCount(props.rank)} on the board`}</Pill>
      </div>

      <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between", gap: GAP }}>
        <div style={col({ width: leftWidth, flexShrink: 1 })}>
          <div
            style={{
              display: "block",
              fontFamily: OG_FONT.display,
              fontWeight: 800,
              fontSize: nameSize,
              lineHeight: 1,
              letterSpacing: em(nameSize, -0.035),
              wordBreak: "break-word",
              lineClamp: 2,
            }}
          >
            {name}
          </div>
          {tldr ? (
            <div style={{ display: "block", marginTop: 18, fontSize: 26, fontWeight: 500, lineHeight: 1.4, color: SOFT, lineClamp: 3 }}>
              {tldr}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            fontFamily: OG_FONT.display,
            fontWeight: 800,
            fontSize: SCORE_SIZE,
            lineHeight: 0.8,
            letterSpacing: em(SCORE_SIZE, -0.04),
            color: ACCENT,
          }}
        >
          {score}
        </div>
      </div>

      <Footer>{TAGLINE}</Footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site card: /og.png
// ---------------------------------------------------------------------------

export interface DefaultCardProps {
  /** The current #1, if the board has one. */
  readonly king: { readonly siteKey: string } | null;
}

const HEADLINE_SIZE = 96;

function Headline({ children, color }: { children: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: OG_FONT.display,
        fontWeight: 800,
        fontSize: HEADLINE_SIZE,
        lineHeight: 1.02,
        letterSpacing: em(HEADLINE_SIZE, -0.035),
        color,
      }}
    >
      {children}
    </div>
  );
}

export function DefaultCard(props: DefaultCardProps) {
  const king = props.king ? truncate(cardText(props.king.siteKey), 40) : "";
  return (
    <div
      style={col({
        width: OG_WIDTH,
        height: OG_HEIGHT,
        padding: `${PAD_Y}px ${PAD_X}px`,
        backgroundColor: PAPER,
        color: INK,
        fontFamily: OG_FONT.sans,
      })}
    >
      <Brand />

      <div style={row({ flex: 1, justifyContent: "space-between", gap: GAP })}>
        <div style={col({ width: 760 })}>
          <Headline color={INK}>Think you're #1?</Headline>
          <Headline color={ACCENT}>Prove it for $5.</Headline>
          <div style={{ display: "flex", marginTop: 24, fontSize: 28, fontWeight: 500, lineHeight: 1.4, color: SOFT }}>
            No bidding, no ads, no buying your way up. Jev reads your site and ranks how useful your business really is.
          </div>
        </div>
        <Face size={240} />
      </div>

      <div style={{ display: "flex" }}>
        {king ? <Pill medal="gold">{`#1 right now: ${king}`}</Pill> : <Pill medal={null}>The board is empty. Be the first.</Pill>}
      </div>
    </div>
  );
}
