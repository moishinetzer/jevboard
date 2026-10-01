import { Effect, Option } from "effect";
import { effectLoader } from "~/.server/http";
import { siteKeyFromAssetPath } from "~/.server/og/path";
import { Icons } from "~/.server/services/Icons";
import type { Route } from "./+types/icon";

/** The address carries the copy's version (?v=), so a copy can be kept for good. */
const FOREVER = "public, max-age=31536000, immutable";

const notFound = () =>
  new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Cloudflare's `caches.default`; undefined on Node. */
const edgeCache = (): EdgeCache | undefined => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

/**
 * GET /icon/<siteKey>?v=<version>: our copy of a listed business's logo (see
 * Icons). Kept at the edge, so a busy board reads each one from the database
 * once.
 */
export const loader = effectLoader("icon", ({ params, request }: Route.LoaderArgs) =>
  Effect.gen(function* () {
    const cache = edgeCache();
    const cached = cache ? yield* Effect.promise(() => cache.match(request).catch(() => undefined)) : undefined;
    if (cached) return cached;

    const icon = yield* (yield* Icons).get(siteKeyFromAssetPath(params["*"], "png"));
    if (Option.isNone(icon)) return notFound();
    const response = new Response(icon.value.bytes, {
      headers: {
        "Content-Type": icon.value.contentType,
        "Content-Length": String(icon.value.bytes.byteLength),
        "Cache-Control": FOREVER,
        "X-Content-Type-Options": "nosniff",
        // It's only ever a picture: opened directly, nothing in it may run or load.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
    if (cache) yield* Effect.promise(() => cache.put(request, response.clone()).catch(() => undefined));
    return response;
  }),
);
