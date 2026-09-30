/**
 * Jev's face as a standalone SVG data URI for satori `<img>`s.
 * Mirrors <JevFace> in app/components/logo.tsx (kept as a string so the OG
 * renderer needs no react-dom/server).
 */
const JEV_FACE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
  '<path d="M18 14 L24 4 L32 12 L40 4 L46 14 Z" fill="#ffd400" stroke="#1d1b16" stroke-width="3" stroke-linejoin="round"/>',
  '<circle cx="32" cy="36" r="24" fill="#ffd400" stroke="#1d1b16" stroke-width="3.5"/>',
  '<circle cx="23" cy="33" r="4" fill="#1d1b16"/>',
  '<circle cx="41" cy="33" r="7.5" fill="#fffdf6" stroke="#1d1b16" stroke-width="3"/>',
  '<circle cx="41" cy="33" r="3.2" fill="#1d1b16"/>',
  '<path d="M48 38 Q52 46 50 54" fill="none" stroke="#1d1b16" stroke-width="2" stroke-linecap="round"/>',
  '<path d="M17 26 L28 28" stroke="#1d1b16" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M35 25 L47 23" stroke="#1d1b16" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M23 46 Q32 42 41 46" fill="none" stroke="#1d1b16" stroke-width="3.5" stroke-linecap="round"/>',
  "</svg>",
].join("");

export const JEV_FACE_DATA_URI = `data:image/svg+xml;base64,${btoa(JEV_FACE_SVG)}`;
