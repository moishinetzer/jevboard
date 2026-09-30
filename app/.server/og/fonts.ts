import type { Font } from "@cf-wasm/og";
import { EMBEDDED_FONTS } from "./fonts.generated";

/** Font families registered with satori; use these names in card styles. */
export const OG_FONT = {
  display: "Bricolage Grotesque",
  sans: "Instrument Sans",
} as const;

const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

let decoded: ReadonlyArray<Font> | undefined;

/**
 * The embedded card fonts, decoded once per process / isolate.
 * No filesystem or network access, so this works in Node and in workerd.
 */
export const ogFonts = (): Array<Font> => {
  decoded ??= EMBEDDED_FONTS.map((font) => ({
    name: font.name,
    weight: font.weight,
    style: "normal" as const,
    data: decodeBase64(font.base64),
  }));
  return [...decoded];
};
