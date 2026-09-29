/**
 * Site key from an asset splat: "stripe.com.png" → "stripe.com",
 * "github.com/Effect-TS.svg" → "github.com/effect-ts". Malformed escapes are
 * kept raw (they simply won't match an entry).
 */
export const siteKeyFromAssetPath = (splat: string | undefined, extension: "png" | "svg"): string => {
  let raw = splat ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  const suffix = `.${extension}`;
  const key = raw.trim().toLowerCase().replace(/\/+$/, "");
  return (key.endsWith(suffix) ? key.slice(0, -suffix.length) : key).replace(/\/+$/, "");
};
