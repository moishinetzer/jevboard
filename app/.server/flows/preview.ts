import { Effect, Option, Result } from "effect";
import { normalizeErrorMessage, normalizeSite } from "~/lib/site-key";
import { CrawlError } from "../domain/errors";
import { type SitePreview, siteProfileOf } from "../domain/models";
import { CurrentRequest } from "../request";
import { track } from "../services/Analytics";
import { Crawler } from "../services/Crawler";
import { Judge } from "../services/Judge";
import { type CachedPreview, Previews } from "../services/Previews";
import { RateLimiter } from "../services/RateLimiter";
import { preflightMessage } from "./submit";

/** A site's read is reused for a week: a refresh or a second visitor costs nothing. */
const PREVIEW_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** The buyer watches this happen, so the crawl gets a short leash (the model gets its own). */
const CRAWL_BUDGET = "25 seconds";
/** Extra pages are a bonus: whatever loaded by then is enough. */
const EXTRA_PAGES_MS = 8_000;
/** One rate-limit key shared by every uncached preview on the site (see `allowed`). */
const GLOBAL_KEY = "all";

/** Only a bad address is the buyer's to fix; a slow or flaky site just skips ahead to payment. */
const isBadAddress = (error: CrawlError): boolean =>
  error.reason === "dns" ||
  error.reason === "blocked" ||
  error.reason === "not-html" ||
  error.reason === "offsite" ||
  (error.reason === "http" && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429);

export type PreviewResult =
  | {
      readonly ok: true;
      readonly site: { readonly siteKey: string; readonly url: string; readonly host: string };
      readonly profile: CachedPreview["profile"];
      readonly preview: SitePreview;
    }
  | {
      readonly ok: false;
      /** "url": the site itself is the problem; "rate" and "preview": skip ahead and let them pay without the read. */
      readonly field: "url" | "rate" | "preview";
      readonly message: string;
    };

/**
 * The guided onboarding's first step: Jev reads the site (homepage plus a
 * couple of pages) and prepares the questions. Cached per site; uncached reads
 * count against the same rate limits as checkouts, since each one costs a
 * crawl and a model call.
 */
export const previewSite = Effect.fn("previewSite")(function* (rawUrl: string) {
  const normalized = normalizeSite(rawUrl);
  if (!normalized.ok) {
    return { ok: false, field: "url", message: normalizeErrorMessage[normalized.error] } satisfies PreviewResult;
  }
  const site = normalized.site;
  const previews = yield* Previews;

  const cached = yield* previews.get(site.siteKey, PREVIEW_MAX_AGE_MS);
  if (Option.isSome(cached)) {
    yield* track("onboarding_preview", { site: site.siteKey, cached: true });
    return { ok: true, site, ...cached.value } satisfies PreviewResult;
  }

  const request = yield* CurrentRequest;
  const limiter = yield* RateLimiter;
  // Per visitor and per network, plus one budget for the whole site: made-up cookies and
  // fresh IPs can't buy more than GLOBAL_KEY's limit of crawls and model calls a minute.
  const allowed =
    (request.visitorIsNew || (yield* limiter.allow("visitor", request.visitorId))) &&
    (yield* limiter.allow("ip", request.clientIp)) &&
    (yield* limiter.allow("preview", GLOBAL_KEY));
  if (!allowed) {
    return { ok: false, field: "rate", message: "Jev is reading a lot of sites right now." } satisfies PreviewResult;
  }

  const crawl = yield* Effect.result(
    // No browser rendering here: free previews mustn't use up the capacity paid judgments need.
    (yield* Crawler).crawl(site.url, { maxExtraPages: 2, render: false, extraPagesWithinMs: EXTRA_PAGES_MS }).pipe(
      Effect.timeoutOrElse({
        duration: CRAWL_BUDGET,
        orElse: () => Effect.fail(new CrawlError({ url: site.url, reason: "timeout", message: `no answer within ${CRAWL_BUDGET}` })),
      }),
    ),
  );
  if (Result.isFailure(crawl)) {
    yield* track("onboarding_preview_failed", { site: site.siteKey, reason: `crawl:${crawl.failure.reason}` });
    return isBadAddress(crawl.failure)
      ? ({ ok: false, field: "url", message: preflightMessage(crawl.failure) } satisfies PreviewResult)
      : ({ ok: false, field: "preview", message: "Jev couldn't read it quickly enough." } satisfies PreviewResult);
  }
  const snapshot = crawl.success;

  const read = yield* Effect.result((yield* Judge).preview({ siteKey: site.siteKey, snapshot }));
  if (Result.isFailure(read)) {
    yield* Effect.logWarning("Onboarding preview failed", { site: site.siteKey, error: read.failure.message });
    yield* track("onboarding_preview_failed", { site: site.siteKey, reason: `model:${read.failure.reason}` });
    return { ok: false, field: "preview", message: "Jev couldn't prepare the questions this time." } satisfies PreviewResult;
  }

  const value: CachedPreview = { profile: siteProfileOf(snapshot), preview: read.success };
  yield* previews.put(site.siteKey, value);
  yield* track("onboarding_preview", { site: site.siteKey, cached: false, pages: snapshot.pages.length });
  return { ok: true, site, ...value } satisfies PreviewResult;
});
