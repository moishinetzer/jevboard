/**
 * Share-card layouts for satori (1200×630). Satori rules: every element with
 * more than one child needs `display: flex`, only inline styles, and only the
 * fonts registered in ./fonts.
 */
import type { CSSProperties, ReactNode } from "react";
import { truncate } from "~/lib/badge";
import { formatCount, formatMoney, tierFor } from "~/lib/format";
import { JEV_FACE_DATA_URI } from "./face";
import { OG_FONT } from "./fonts";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const INK = "#111110";
const INK_SOFT = "#4a463d";
const PAPER = "#fbf6e7";
const CARD = "#fffdf6";
const JEV = "#ffd400";
const HOT = "#ff3b1f";
const MUTED_ON_INK = "#b9b2a0";

const row = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", alignItems: "center", ...style });
const col = (style: CSSProperties = {}): CSSProperties => ({ display: "flex", flexDirection: "column", ...style });

function Face({ size, rotate = 0 }: { size: number; rotate?: number }) {
  return (
    <img
      src={JEV_FACE_DATA_URI}
      width={size}
      height={size}
      style={rotate ? { width: size, height: size, transform: `rotate(${rotate}deg)` } : { width: size, height: size }}
    />
  );
}

function Wordmark({ size }: { size: number }) {
  return (
    <div style={row({ fontFamily: OG_FONT.display, fontSize: size, lineHeight: 1, letterSpacing: -1 })}>
      <span>JEV</span>
      <span style={{ color: HOT }}>BOARD</span>
    </div>
  );
}

/** Font size that fits `text` on one line of `width` px, for a face averaging `em` per glyph. */
const fitFont = (text: string, width: number, em: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(width / Math.max(1, [...text].length * em))));

const serialLabel = (serial: number): string => `#${String(serial).padStart(4, "0")}`;

/**
 * Emoji would need a remote asset fetch at render time (disabled), so drop
 * them (and their joiners/variation selectors) instead of drawing tofu.
 */
export const cardText = (text: string): string =>
  text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0E\uFE0F\u20E3]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Verdict card: /og/<siteKey>.png
// ---------------------------------------------------------------------------

export interface EntryCardProps {
  readonly siteKey: string;
  readonly score: number;
  readonly rank: number;
  readonly total: number;
  /** Hyphenated verdict label. */
  readonly label: string;
  /** Jev's roast line. */
  readonly roast: string;
  /** Global judgment serial ("Judgment #0042"). */
  readonly serial: number;
  /** 1 for a first judgment, 2+ for retrials. */
  readonly roll: number;
  /** Public host for the footer, e.g. "jevboard.com". */
  readonly host: string;
}

const LEFT_COLUMN = 680;

export function EntryCard(props: EntryCardProps) {
  const tier = tierFor(props.score);
  const siteKey = truncate(cardText(props.siteKey), 60);
  // Short keys get one huge line; long ones (github.com/org, producthunt paths) may wrap to two.
  const oneLine = fitFont(siteKey, LEFT_COLUMN, 0.58, 20, 88);
  const siteSize = oneLine >= 56 ? oneLine : Math.min(56, fitFont(siteKey, LEFT_COLUMN * 2, 0.58, 30, 88));
  const siteWraps = [...siteKey].length * 0.58 * siteSize > LEFT_COLUMN;
  const label = truncate(cardText(props.label), 88);
  const roast = truncate(cardText(props.roast), 150);
  const scoreSize = props.score >= 1000 ? 178 : 220;

  return (
    <div style={col({ width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: PAPER, color: INK, fontFamily: OG_FONT.sans })}>
      {/* Masthead */}
      <div style={row({ height: 104, padding: "0 44px", backgroundColor: JEV, borderBottom: `6px solid ${INK}` })}>
        <Face size={70} />
        <div style={{ display: "flex", marginLeft: 14 }}>
          <Wordmark size={60} />
        </div>
        <div style={row({ marginLeft: "auto", gap: 18 })}>
          <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 22 }}>
            {`JUDGMENT ${serialLabel(props.serial)}`}
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 18px 6px",
              backgroundColor: INK,
              color: JEV,
              fontFamily: OG_FONT.display,
              fontSize: 32,
              transform: "rotate(-3deg)",
            }}
          >
            OFFICIAL VERDICT
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, padding: "30px 44px 0", gap: 40 }}>
        <div style={col({ width: LEFT_COLUMN, overflow: "hidden" })}>
          <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 20, color: INK_SOFT, letterSpacing: 2 }}>
            {props.roll > 1 ? `THE DEFENDANT · RETRIAL #${props.roll - 1}` : "THE DEFENDANT"}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 4,
              fontWeight: 700,
              fontSize: siteSize,
              lineHeight: 1.05,
              letterSpacing: -2,
              wordBreak: "break-word",
            }}
          >
            {siteKey}
          </div>
          <div style={row({ marginTop: 16, gap: 12 })}>
            <div
              style={{
                display: "flex",
                padding: "4px 12px",
                backgroundColor: tier.color,
                color: tier.ink,
                border: `3px solid ${INK}`,
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: 1,
              }}
            >
              {tier.label.toUpperCase()}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginTop: 20,
              padding: "8px 14px",
              backgroundColor: JEV,
              border: `4px solid ${INK}`,
              boxShadow: `5px 5px 0 ${INK}`,
              fontFamily: OG_FONT.mono,
              fontWeight: 700,
              fontSize: 25,
              lineHeight: 1.3,
              transform: "rotate(-1deg)",
              maxWidth: LEFT_COLUMN - 10,
            }}
          >
            {`“${label}”`}
          </div>
          <div
            style={{
              display: "block",
              marginTop: 22,
              fontWeight: 500,
              fontSize: 26,
              lineHeight: 1.3,
              color: INK_SOFT,
              lineClamp: siteWraps ? 2 : 3,
            }}
          >
            {`“${roast}”`}
          </div>
        </div>

        <div style={col({ flex: 1, alignItems: "stretch" })}>
          <div
            style={col({
              alignItems: "center",
              justifyContent: "center",
              height: 300,
              backgroundColor: tier.color,
              color: tier.ink,
              border: `6px solid ${INK}`,
              boxShadow: `12px 12px 0 ${INK}`,
            })}
          >
            <div style={{ display: "flex", fontFamily: OG_FONT.display, fontSize: scoreSize, lineHeight: 1, marginTop: -8 }}>
              {String(props.score)}
            </div>
            <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 30, marginTop: 2 }}>/ 1000</div>
          </div>
          <div
            style={row({
              justifyContent: "center",
              marginTop: 26,
              padding: "6px 0 4px",
              backgroundColor: INK,
              color: PAPER,
              fontFamily: OG_FONT.display,
              fontSize: 52,
              lineHeight: 1.1,
              transform: "rotate(1.5deg)",
            })}
          >
            <span>{`#${formatCount(props.rank)}`}</span>
            <span style={{ color: JEV, marginLeft: 14 }}>{`OF ${formatCount(props.total)}`}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={row({ height: 74, padding: "0 44px", backgroundColor: INK, color: PAPER, justifyContent: "space-between" })}>
        <div style={row({ fontFamily: OG_FONT.display, fontSize: 34, lineHeight: 1 })}>
          <span>DEMAND A RETRIAL AT</span>
          <span style={{ color: JEV, marginLeft: 12 }}>{props.host.toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 20, color: MUTED_ON_INK }}>
          YOU CAN'T BUY #1
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site card: /og.png
// ---------------------------------------------------------------------------

export interface DefaultCardProps {
  readonly entries: number;
  readonly judgments: number;
  readonly revenueCents: number;
  readonly king: { readonly siteKey: string; readonly score: number } | null;
  readonly host: string;
}

function Stat({ value, label, last = false }: { value: string; label: string; last?: boolean }) {
  return (
    <div
      style={col({
        justifyContent: "center",
        padding: "0 28px",
        borderRight: last ? "none" : `3px solid #3a382f`,
      })}
    >
      <div style={{ display: "flex", fontFamily: OG_FONT.display, fontSize: 50, lineHeight: 1, color: JEV }}>{value}</div>
      <div style={{ display: "flex", marginTop: 6, fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 17, color: MUTED_ON_INK, letterSpacing: 1 }}>
        {label}
      </div>
    </div>
  );
}

function Headline({ children, color = INK }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", fontFamily: OG_FONT.display, fontSize: 128, lineHeight: 0.98, color, letterSpacing: -1 }}>{children}</div>
  );
}

export function DefaultCard(props: DefaultCardProps) {
  const king = props.king ? truncate(props.king.siteKey, 26) : null;
  return (
    <div style={col({ width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: JEV, color: INK, fontFamily: OG_FONT.sans })}>
      <div
        style={{
          display: "flex",
          flex: 1,
          padding: "44px 56px 0",
          // Tabloid halftone. Satori only honours percentage colour stops here.
          backgroundImage: "radial-gradient(circle, #e6bf00 16%, transparent 21%)",
          backgroundSize: "18px 18px",
        }}
      >
        <div style={col({ flex: 1 })}>
          <div style={row({ gap: 16 })}>
            <div style={{ display: "flex", padding: "6px 14px 4px", backgroundColor: INK }}>
              <div style={row({ fontFamily: OG_FONT.display, fontSize: 34, lineHeight: 1, color: PAPER })}>
                <span>JEV</span>
                <span style={{ color: HOT }}>BOARD</span>
              </div>
            </div>
            <div style={{ display: "flex", fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 20, letterSpacing: 1 }}>
              THE INTERNET'S MOST HONEST BILLBOARD
            </div>
          </div>
          <div style={col({ marginTop: 22 })}>
            <Headline>PAY $5.</Headline>
            <Headline>GET JUDGED</Headline>
            <div style={row({ gap: 26 })}>
              <Headline>BY</Headline>
              <div
                style={{
                  display: "flex",
                  padding: "0 18px",
                  backgroundColor: INK,
                  transform: "rotate(-2deg)",
                }}
              >
                <Headline color={JEV}>JEV.</Headline>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 18, fontWeight: 700, fontSize: 30 }}>
            You can't buy #1. You can only buy Jev's attention.
          </div>
        </div>
        <div style={col({ width: 330, alignItems: "center", justifyContent: "center", marginTop: -10 })}>
          <Face size={320} rotate={-8} />
          <div
            style={{
              display: "flex",
              marginTop: -6,
              padding: "8px 16px",
              backgroundColor: CARD,
              border: `4px solid ${INK}`,
              boxShadow: `6px 6px 0 ${INK}`,
              fontFamily: OG_FONT.mono,
              fontWeight: 700,
              fontSize: 22,
              transform: "rotate(3deg)",
            }}
          >
            {`1–1000 · NO DRAWS`}
          </div>
        </div>
      </div>

      <div style={row({ height: 128, backgroundColor: INK, color: PAPER, borderTop: `6px solid ${INK}`, padding: "0 28px" })}>
        <Stat value={formatCount(props.entries)} label="DEFENDANTS" />
        <Stat value={formatCount(props.judgments)} label="JUDGMENTS" />
        <Stat value={formatMoney(props.revenueCents)} label="FED TO JEV" />
        <div style={col({ flex: 1, justifyContent: "center", padding: "0 28px" })}>
          {king && props.king ? (
            <div style={col({})}>
              <div style={row({ fontFamily: OG_FONT.display, fontSize: 40, lineHeight: 1, color: PAPER })}>
                <span style={{ color: JEV, marginRight: 12 }}>#1</span>
                <span>{king.toUpperCase()}</span>
              </div>
              <div style={{ display: "flex", marginTop: 8, fontFamily: OG_FONT.mono, fontWeight: 700, fontSize: 17, color: MUTED_ON_INK, letterSpacing: 1 }}>
                {`CURRENT KING · ${props.king.score}/1000`}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontFamily: OG_FONT.display, fontSize: 36, lineHeight: 1.05, color: PAPER }}>
              THE DOCKET IS EMPTY. BE THE FIRST DEFENDANT.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
