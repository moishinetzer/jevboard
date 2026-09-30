/**
 * Renders the brand images that Stripe (checkout, receipts) and Autumn need,
 * from the same face and fonts as the share cards:
 *
 *   pnpm exec tsx scripts/brand-assets.tsx
 *
 * Writes data/brand/icon.png (512×512, Jev on paper) and data/brand/logo.png
 * (the "rankedbyjev" wordmark with Jev, transparent).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { render } from "@cf-wasm/og";
import type { ReactElement } from "react";
import { JEV_FACE_DATA_URI } from "../app/.server/og/face";
import { OG_FONT, ogFonts } from "../app/.server/og/fonts";

const PAPER = "#fcfaf3";
const INK = "#1d1b16";

const png = async (element: ReactElement, width: number, height: number) => {
  const { image } = await render(element, { width, height, fonts: ogFonts(), loadAdditionalAsset: () => [] }).asPng();
  return image;
};

const icon = (
  <div style={{ display: "flex", width: 512, height: 512, alignItems: "center", justifyContent: "center", backgroundColor: PAPER }}>
    <img src={JEV_FACE_DATA_URI} width={400} height={400} style={{ width: 400, height: 400 }} />
  </div>
);

const LOGO_HEIGHT = 240;
const logo = (
  <div style={{ display: "flex", height: LOGO_HEIGHT, alignItems: "center", gap: 28, padding: "0 16px" }}>
    <img src={JEV_FACE_DATA_URI} width={200} height={200} style={{ width: 200, height: 200 }} />
    <div
      style={{
        display: "flex",
        fontFamily: OG_FONT.display,
        fontWeight: 700,
        fontSize: 132,
        lineHeight: 1,
        letterSpacing: -2.6,
        color: INK,
      }}
    >
      rankedbyjev
    </div>
  </div>
);

mkdirSync("data/brand", { recursive: true });
writeFileSync("data/brand/icon.png", await png(icon, 512, 512));
writeFileSync("data/brand/logo.png", await png(logo, 1080, LOGO_HEIGHT));
console.log("wrote data/brand/icon.png and data/brand/logo.png");
