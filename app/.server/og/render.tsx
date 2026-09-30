/**
 * OG share-card rendering: satori (JSX → SVG) + resvg (SVG → PNG) via
 * @cf-wasm/og, which picks its Node or workerd WASM build from the export
 * conditions. Fonts are embedded (./fonts.generated.ts) and missing glyphs are
 * never fetched remotely, so a render does no I/O at all.
 *
 * Two cache layers sit in front of the renderer:
 *  1. an in-memory LRU of PNG promises (per process / isolate, dedupes
 *     concurrent renders of the same card);
 *  2. the Workers Cache API (`caches.default`) when running on Cloudflare.
 * Keys include everything drawn on the card (the judgment id stands in for its
 * name and TL;DR), so a retrial or a rank change produces a new key instead of
 * serving a stale image.
 */
import { render } from "@cf-wasm/og";
import type { ReactElement } from "react";
import { DefaultCard, type DefaultCardProps, EntryCard, type EntryCardProps, OG_HEIGHT, OG_WIDTH } from "./cards";
import { ogFonts } from "./fonts";
import { LruCache } from "./lru";

export { OG_HEIGHT, OG_WIDTH };
export type { DefaultCardProps, EntryCardProps };

/** PNG bytes backed by a plain ArrayBuffer (valid as a Response body everywhere). */
export type Png = Uint8Array<ArrayBuffer>;

/** Renders a satori element to PNG bytes. */
export const renderPng = async (element: ReactElement): Promise<Png> => {
  const { image } = await render(element, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: ogFonts(),
    // Never fetch fonts or emoji at render time: unknown glyphs just drop out.
    loadAdditionalAsset: () => [],
  }).asPng();
  return image;
};

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

const memory = new LruCache<string, Promise<Png>>(256);

interface EdgeCache {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

/** Cloudflare's `caches.default`; undefined on Node. */
const edgeCache = (): EdgeCache | undefined =>
  (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

/** How long the edge keeps a rendered card. Keys are content-addressed, so this can be long. */
const EDGE_TTL_SECONDS = 7 * 24 * 3600;

const viaEdgeCache = async (key: string, origin: string, make: () => Promise<Png>): Promise<Png> => {
  const cache = edgeCache();
  if (!cache) return make();
  const cacheUrl = `${origin}/__og-cache/${encodeURIComponent(key)}.png`;
  const hit = await cache.match(cacheUrl).catch(() => undefined);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const bytes = await make();
  await cache
    .put(
      cacheUrl,
      new Response(bytes, {
        headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}` },
      }),
    )
    .catch(() => undefined);
  return bytes;
};

/**
 * Returns the cached PNG for `key`, rendering it at most once per process
 * (concurrent callers share the same promise). Failed renders are forgotten.
 */
export const cachedCard = (key: string, origin: string, make: () => Promise<Png>): Promise<Png> => {
  const existing = memory.get(key);
  if (existing) return existing;
  const pending = viaEdgeCache(key, origin, make);
  memory.set(key, pending);
  pending.catch(() => {
    if (memory.get(key) === pending) memory.delete(key);
  });
  return pending;
};

/** Everything that changes the verdict card's pixels. */
export const entryCardKey = (judgmentId: string, props: EntryCardProps): string =>
  ["entry", props.siteKey, judgmentId, props.rank, props.score, props.name].join("|");

export const defaultCardKey = (props: DefaultCardProps): string => ["site", props.king?.siteKey ?? ""].join("|");

/** The verdict share card for one entry, keyed by (siteKey, judgmentId) plus its current rank. */
export const entryCardPng = (judgmentId: string, props: EntryCardProps, origin: string): Promise<Png> =>
  cachedCard(entryCardKey(judgmentId, props), origin, () => renderPng(<EntryCard {...props} />));

/** The site-wide default card (/og.png). */
export const defaultCardPng = (props: DefaultCardProps, origin: string): Promise<Png> =>
  cachedCard(defaultCardKey(props), origin, () => renderPng(<DefaultCard {...props} />));

/** Test hook. */
export const clearCardCache = (): void => memory.clear();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const OG_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export const pngResponse = (bytes: Png): Response =>
  new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": OG_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
