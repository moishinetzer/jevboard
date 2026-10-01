/** A site's icon is at most this big (a 180px apple-touch-icon is usually under 30 KB). */
export const MAX_ICON_BYTES = 400_000;

export interface FetchedIcon {
  /** The type its bytes say it is: image/png, image/jpeg, image/webp, image/gif or image/x-icon. */
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * The picture format a file's first bytes announce, or null when it isn't one
 * of the plain raster formats a browser draws without running anything. SVG
 * (which can carry scripts) and HTML error pages come out null.
 */
export const sniffImageType = (bytes: Uint8Array): string | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  return null;
};
