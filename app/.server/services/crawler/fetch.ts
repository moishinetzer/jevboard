import { Duration, Effect } from "effect";
import { CrawlError } from "../../domain/errors";
import { decodeHtml, isHtmlContentType, looksLikeHtml } from "./html";
import { type FetchedIcon, MAX_ICON_BYTES, sniffImageType } from "./icon";
import { guardHost, hopViolation, type Resolver } from "./ssrf";

export const MAX_REDIRECTS = 5;

/**
 * Bodies are read incrementally and cut at this many (decoded-by-fetch)
 * bytes. Over-long pages — homepage included — are truncated rather than
 * rejected: title/meta live in the head and the extracted text is capped far
 * below this anyway, so failing heavy-but-legit homepages (Framer, big SSR
 * payloads) would only turn away real businesses. Reading stops at the cap,
 * so memory and bandwidth stay bounded, which is all the cap is for.
 */
export const MAX_BODY_BYTES = 1_500_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchedPage {
  /** URL after redirects (fragment dropped). */
  readonly url: string;
  readonly html: string;
  /** The body was cut at `MAX_BODY_BYTES`. */
  readonly truncated: boolean;
}

/** The HTTP client: `fetch`'s shape. */
export type HttpFetch = (url: URL, init: RequestInit) => Promise<Response>;

export interface PageFetcherOptions {
  readonly userAgent: string;
  /** Used for every hop unless `allowPrivateNetwork` is set. */
  readonly resolve: Resolver;
  /** TEST ONLY: skip the host/port rules and the address check. */
  readonly allowPrivateNetwork: boolean;
  /**
   * Sends one request. Default: the global `fetch`. Tests pass a scripted
   * one; the SSRF guard runs before it either way.
   */
  readonly fetch?: HttpFetch;
}

// ---------------------------------------------------------------------------
// One HTTP exchange (no redirect following)
// ---------------------------------------------------------------------------

/** What a request is after: pages and icons share the guard, the redirects and the size cap. */
interface Wanted {
  readonly accept: string;
  /** For error messages: "an HTML page", "an image". */
  readonly what: string;
  /** Whether a declared content type is worth downloading. */
  readonly accepts: (contentType: string) => boolean;
  readonly maxBytes: number;
}

const HTML_PAGE: Wanted = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  what: "an HTML page",
  accepts: isHtmlContentType,
  maxBytes: MAX_BODY_BYTES,
};

type Hop =
  | { readonly _tag: "Redirect"; readonly status: number; readonly location: string | undefined }
  | { readonly _tag: "Status"; readonly status: number }
  | { readonly _tag: "WrongType"; readonly contentType: string }
  | {
      readonly _tag: "Body";
      readonly contentType: string | undefined;
      readonly bytes: Uint8Array;
      readonly truncated: boolean;
    };

/** Frees the connection without reading the body. */
const discard = (response: Response): void => {
  response.body?.cancel().catch(() => {});
};

const concat = (chunks: ReadonlyArray<Uint8Array>, size: number): Uint8Array => {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** Reads at most `maxBytes`, then cancels the stream. */
const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> => {
  if (body === null) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Array<Uint8Array> = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes: concat(chunks, size), truncated: false };
      const room = maxBytes - size;
      if (value.length > room) {
        chunks.push(value.subarray(0, room));
        return { bytes: concat(chunks, maxBytes), truncated: true };
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
};

const sendHop = async (
  send: HttpFetch,
  url: URL,
  headers: Record<string, string>,
  wanted: Wanted,
  signal: AbortSignal,
): Promise<Hop> => {
  // `redirect: "manual"` hands us the 3xx itself (Node and workerd; not browsers).
  const response = await send(url, { method: "GET", headers, redirect: "manual", signal });
  const status = response.status;
  if (REDIRECT_STATUSES.has(status)) {
    discard(response);
    return { _tag: "Redirect", status, location: response.headers.get("location") ?? undefined };
  }
  if (status < 200 || status > 299) {
    discard(response);
    return { _tag: "Status", status };
  }
  const contentType = response.headers.get("content-type")?.trim() || undefined;
  if (contentType !== undefined && !wanted.accepts(contentType)) {
    discard(response);
    return { _tag: "WrongType", contentType };
  }
  const { bytes, truncated } = await readCapped(response.body, wanted.maxBytes);
  return { _tag: "Body", contentType, bytes, truncated };
};

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type ErrorLike = { readonly code?: unknown; readonly message?: unknown };

/** The error and its `cause`s / AggregateError members (Node's fetch nests the socket error). */
const errorChain = (error: unknown): Array<ErrorLike> => {
  const out: Array<ErrorLike> = [];
  const queue: Array<unknown> = [error];
  while (queue.length > 0 && out.length < 20) {
    const next = queue.shift();
    if (typeof next !== "object" || next === null) continue;
    out.push(next);
    if ("cause" in next) queue.push(next.cause);
    if (next instanceof AggregateError) queue.push(...next.errors);
  }
  return out;
};

const DNS_CODES = new Set(["ENOTFOUND", "ENODATA", "EAI_FAIL", "EAI_NONAME"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
/** Node's certificate and handshake codes (CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID, ERR_SSL_...). */
const TLS_CODE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;
/** workerd has no codes, only messages. */
const TLS_MESSAGE = /certificate|\bTLS\b|\bSSL\b/i;
/** Prefix of every TLS failure's message; `isTlsCrawlError` relies on it. */
const TLS_FAILURE = "TLS/certificate error";

const describeCode = (code: string): string => {
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection reset";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "host unreachable";
  return `network error (${code})`;
};

/** Maps a thrown fetch/stream error. Node exposes errno-style codes; workerd only messages. */
const transportError = (url: string, cause: unknown): CrawlError => {
  const chain = errorChain(cause);
  const codes = chain.flatMap((error) => (typeof error.code === "string" ? [error.code] : []));
  if (codes.some((code) => DNS_CODES.has(code))) {
    return new CrawlError({ url, reason: "dns", message: "the domain does not resolve" });
  }
  if (codes.some((code) => TIMEOUT_CODES.has(code))) {
    return new CrawlError({ url, reason: "timeout", message: "the server took too long to respond" });
  }
  // A reset mid-handshake ("... before secure TLS connection was established") has a code and stays a reset.
  const tlsCode = codes.find((code) => TLS_CODE.test(code));
  const tlsMessage =
    codes.length === 0 && chain.some((error) => typeof error.message === "string" && TLS_MESSAGE.test(error.message));
  if (tlsCode !== undefined || tlsMessage) {
    return new CrawlError({
      url,
      reason: "unreachable",
      message: tlsCode !== undefined ? `${TLS_FAILURE} (${tlsCode})` : TLS_FAILURE,
    });
  }
  const detail = codes[0] !== undefined ? describeCode(codes[0]) : String(chain.at(-1)?.message ?? "network error");
  return new CrawlError({ url, reason: "unreachable", message: detail.slice(0, 200) });
};

/**
 * The address answered, but not over valid TLS (bad or expired certificate,
 * failed handshake). Asking the same address again won't help; another
 * address (www, plain http) might.
 */
export const isTlsCrawlError = (error: CrawlError): boolean =>
  error.reason === "unreachable" && error.message.startsWith(TLS_FAILURE);

const parseUrl = (href: string, base?: URL): URL | undefined => {
  try {
    const url = new URL(href, base);
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// The guarded fetch
// ---------------------------------------------------------------------------

interface Fetched {
  /** URL after redirects (fragment dropped). */
  readonly url: string;
  readonly contentType: string | undefined;
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

/**
 * One guarded GET: follows up to `MAX_REDIRECTS` redirects by hand so every
 * hop goes through the SSRF guard again. The whole chain (DNS checks
 * included) shares one deadline. Failures are `CrawlError`s whose `url` is
 * always the URL that was asked for; HTTP failures carry the `status`. One
 * attempt only: retrying is the caller's call.
 */
const makeGuardedGet = (options: PageFetcherOptions, wanted: Wanted) => {
  const send: HttpFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const headers = {
    "user-agent": options.userAgent,
    accept: wanted.accept,
    "accept-language": "en-US,en;q=0.9",
  };

  return (requestedUrl: string, timeout: Duration.Input): Effect.Effect<Fetched, CrawlError> =>
    Effect.gen(function* () {
      const fail = (reason: CrawlError["reason"], message: string) =>
        Effect.fail(new CrawlError({ url: requestedUrl, reason, message }));
      const failHttp = (status: number, message: string) =>
        Effect.fail(new CrawlError({ url: requestedUrl, reason: "http", message, status }));

      let url = parseUrl(requestedUrl);
      if (url === undefined) return yield* fail("blocked", "not a valid URL");

      for (let redirects = 0; ; redirects++) {
        const violation = hopViolation(url, options.allowPrivateNetwork);
        if (violation !== undefined) {
          return yield* fail("blocked", redirects === 0 ? violation : `redirect to ${url.href} refused: ${violation}`);
        }
        if (!options.allowPrivateNetwork) yield* guardHost(options.resolve, url.hostname, requestedUrl);

        const target = url;
        const hop = yield* Effect.tryPromise({
          try: (signal) => sendHop(send, target, headers, wanted, signal),
          catch: (cause) => transportError(requestedUrl, cause),
        });
        switch (hop._tag) {
          case "Redirect": {
            if (hop.location === undefined) return yield* failHttp(hop.status, `HTTP ${hop.status} without a Location`);
            if (redirects >= MAX_REDIRECTS) return yield* failHttp(hop.status, `more than ${MAX_REDIRECTS} redirects`);
            url = parseUrl(hop.location, url);
            if (url === undefined) return yield* failHttp(hop.status, `HTTP ${hop.status} to an invalid Location`);
            continue;
          }
          case "Status":
            return yield* failHttp(hop.status, `HTTP ${hop.status}`);
          case "WrongType":
            return yield* fail("not-html", `expected ${wanted.what}, got ${hop.contentType}`);
          case "Body":
            return { url: url.href, contentType: hop.contentType, bytes: hop.bytes, truncated: hop.truncated };
        }
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new CrawlError({
              url: requestedUrl,
              reason: "timeout",
              message: `no complete response within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
            }),
          ),
      }),
    );
};

/** Builds `fetchPage(url, timeout)`: GETs an HTML page through the guard. Over-long pages are cut, not refused. */
export const makePageFetcher = (options: PageFetcherOptions) => {
  const get = makeGuardedGet(options, HTML_PAGE);
  return Effect.fn("Crawler.fetchPage")(function* (requestedUrl: string, timeout: Duration.Input) {
    const fetched = yield* get(requestedUrl, timeout);
    if (fetched.contentType === undefined && !looksLikeHtml(fetched.bytes)) {
      return yield* new CrawlError({
        url: requestedUrl,
        reason: "not-html",
        message: "expected an HTML page, got an untyped non-HTML response",
      });
    }
    const page: FetchedPage = {
      url: fetched.url,
      html: decodeHtml(fetched.bytes, fetched.contentType),
      truncated: fetched.truncated,
    };
    return page;
  });
};

/**
 * Builds `fetchIcon(url, timeout)`: GETs a site's icon through the same
 * guard. The type comes from the file's first bytes, never from what the
 * server calls it; anything that isn't a plain picture (SVG included, which
 * can carry scripts) or is over `MAX_ICON_BYTES` is refused.
 */
export const makeIconFetcher = (options: PageFetcherOptions) => {
  const get = makeGuardedGet(options, {
    accept: "image/png,image/jpeg,image/webp,image/*;q=0.8",
    what: "an image",
    accepts: (contentType) => /^(image\/|application\/octet-stream)/i.test(contentType),
    maxBytes: MAX_ICON_BYTES,
  });
  return Effect.fn("Crawler.fetchIcon")(function* (requestedUrl: string, timeout: Duration.Input) {
    const fail = (reason: CrawlError["reason"], message: string) => new CrawlError({ url: requestedUrl, reason, message });
    const fetched = yield* get(requestedUrl, timeout);
    if (fetched.truncated) return yield* fail("too-large", `the icon is over ${MAX_ICON_BYTES / 1000} KB`);
    const contentType = sniffImageType(fetched.bytes);
    if (contentType === null) return yield* fail("not-html", "expected a PNG, JPEG, WebP, GIF or ICO image");
    const icon: FetchedIcon = { contentType, bytes: fetched.bytes };
    return icon;
  });
};
