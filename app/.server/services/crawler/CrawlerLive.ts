import { Clock, type Duration, Effect, Layer, Option } from "effect";
import { AppConfig } from "../../config";
import type { CrawledPage, SiteSnapshot } from "../../domain/models";
import { Crawler, type CrawlOptions } from "../Crawler";
import { makePageFetcher } from "./fetch";
import { type ExtractedPage, extractPage } from "./html";
import { pageKey, selectLinks } from "./links";
import { makeDohResolver, type Resolver } from "./ssrf";

export interface CrawlerOptions {
  readonly userAgent: string;
  /** How hostnames are resolved for the private-address check. Default: DNS-over-HTTPS (Cloudflare). */
  readonly resolve?: Resolver;
  /**
   * TEST ONLY: lets the crawler reach loopback/private addresses, IP literals
   * and any port (no resolution, no address check), so tests can crawl a
   * local server. Protocol and credential checks still apply. Never enable
   * this for user-submitted URLs.
   */
  readonly allowPrivateNetwork?: boolean;
  /** Budget for one page including its redirects and DNS checks. Default 12 s. */
  readonly pageTimeout?: Duration.Input;
  /** Budget for `preflight`. Default 8 s. */
  readonly preflightTimeout?: Duration.Input;
}

const DEFAULT_PAGE_TIMEOUT = "12 seconds";
const DEFAULT_PREFLIGHT_TIMEOUT = "8 seconds";
const DEFAULT_EXTRA_PAGES = 3;
const MAX_EXTRA_PAGES = 10;
const EXTRA_PAGE_CONCURRENCY = 3;
const HOME_TEXT_CHARS = 12_000;
const EXTRA_TEXT_CHARS = 6_000;

const toCrawledPage = (url: string, page: ExtractedPage): CrawledPage => ({
  url,
  title: page.title,
  description: page.description,
  headings: page.headings,
  text: page.text,
});

/**
 * Builds the crawler service. Uses only web-standard APIs (global `fetch`,
 * streams, TextDecoder), so it runs on Cloudflare Workers as well as Node.
 */
export const makeCrawler = (options: CrawlerOptions): Crawler["Service"] => {
  const pageTimeout = options.pageTimeout ?? DEFAULT_PAGE_TIMEOUT;
  const preflightTimeout = options.preflightTimeout ?? DEFAULT_PREFLIGHT_TIMEOUT;
  const fetchPage = makePageFetcher({
    userAgent: options.userAgent,
    resolve: options.resolve ?? makeDohResolver(),
    allowPrivateNetwork: options.allowPrivateNetwork === true,
  });

  const preflight = Effect.fn("Crawler.preflight")(function* (url: string) {
    const page = yield* fetchPage(url, preflightTimeout);
    return { finalUrl: page.url };
  });

  const crawl = Effect.fn("Crawler.crawl")(function* (url: string, crawlOptions?: CrawlOptions) {
    const maxExtraPages = Math.max(0, Math.min(crawlOptions?.maxExtraPages ?? DEFAULT_EXTRA_PAGES, MAX_EXTRA_PAGES));

    // The homepage must load; everything else is best effort.
    const home = yield* fetchPage(url, pageTimeout);
    const homePage = extractPage(home.html, home.url, HOME_TEXT_CHARS);

    const targets = selectLinks(homePage.links, { pageUrl: home.url, scopeUrl: url, max: maxExtraPages });
    const extras = yield* Effect.forEach(
      targets,
      (target) =>
        fetchPage(target, pageTimeout).pipe(
          Effect.map((page) => toCrawledPage(page.url, extractPage(page.html, page.url, EXTRA_TEXT_CHARS))),
          Effect.tapError((error) => Effect.logDebug("Skipping extra page", { url: target, reason: error.reason })),
          Effect.option,
        ),
      { concurrency: EXTRA_PAGE_CONCURRENCY },
    );

    // Extra pages that redirected back home (or onto each other) are dropped.
    const pages: Array<CrawledPage> = [toCrawledPage(home.url, homePage)];
    const seen = new Set([pageKey(home.url)]);
    for (const extra of extras) {
      if (Option.isNone(extra) || seen.has(pageKey(extra.value.url))) continue;
      seen.add(pageKey(extra.value.url));
      pages.push(extra.value);
    }

    const snapshot: SiteSnapshot = {
      requestedUrl: url,
      finalUrl: home.url,
      host: new URL(home.url).hostname.replace(/^www\./, ""),
      title: homePage.title,
      description: homePage.description,
      ogImage: homePage.ogImage,
      favicon: homePage.favicon,
      pages,
      fetchedAt: yield* Clock.currentTimeMillis,
    };
    return snapshot;
  });

  return Crawler.of({ preflight, crawl });
};

/** A crawler layer with explicit options (tests: fake `resolve`, or `allowPrivateNetwork: true`). */
export const crawlerLayer = (options: CrawlerOptions): Layer.Layer<Crawler> =>
  Layer.sync(Crawler, () => makeCrawler(options));

/** Production crawler: full SSRF guard with DNS-over-HTTPS, User-Agent from config. */
export const CrawlerLive: Layer.Layer<Crawler, never, AppConfig> = Layer.effect(
  Crawler,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return makeCrawler({ userAgent: config.crawlUserAgent });
  }),
);
