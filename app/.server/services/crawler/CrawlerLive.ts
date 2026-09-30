import { Clock, Duration, Effect, Layer, Schedule } from "effect";
import { AppConfig } from "../../config";
import type { CrawledPage, SiteSnapshot } from "../../domain/models";
import { CrawlError, isTransientCrawlError } from "../../domain/errors";
import { Crawler, type CrawlOptions } from "../Crawler";
import { type FetchedPage, type HttpFetch, isTlsCrawlError, makePageFetcher } from "./fetch";
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
  /** Sends one request. Default: the global `fetch` (tests pass a scripted one). */
  readonly fetch?: HttpFetch;
  /**
   * Budgets for successive attempts at the homepage in `crawl`, each covering
   * its redirects and DNS checks. One attempt per entry, so a slow site gets
   * longer on every try; sibling addresses get all entries but the last.
   * Default 12 s, 20 s, 30 s.
   */
  readonly homeTimeouts?: ReadonlyArray<Duration.Input>;
  /** Budget for one attempt at an extra page (two attempts each). Default 12 s. */
  readonly pageTimeout?: Duration.Input;
  /** First pause between homepage attempts; it doubles each time, with jitter. Default 1 s. */
  readonly retryBackoff?: Duration.Input;
  /** First pause before retrying an extra page or a preflight. Default 250 ms. */
  readonly quickRetryBackoff?: Duration.Input;
  /** Hard ceiling for a whole `crawl`, retries and fallbacks included. Default 3 minutes. */
  readonly crawlCeiling?: Duration.Input;
  /** Budget for one `preflight` attempt. Default 8 s. */
  readonly preflightTimeout?: Duration.Input;
  /** Hard ceiling for a whole `preflight`, which runs while the buyer waits. Default 15 s. */
  readonly preflightCeiling?: Duration.Input;
}

const DEFAULT_HOME_TIMEOUTS: ReadonlyArray<Duration.Input> = ["12 seconds", "20 seconds", "30 seconds"];
const DEFAULT_PAGE_TIMEOUT = "12 seconds";
const DEFAULT_RETRY_BACKOFF = "1 second";
const DEFAULT_QUICK_RETRY_BACKOFF = "250 millis";
const DEFAULT_CRAWL_CEILING = "3 minutes";
const DEFAULT_PREFLIGHT_TIMEOUT = "8 seconds";
const DEFAULT_PREFLIGHT_CEILING = "15 seconds";
const DEFAULT_EXTRA_PAGES = 3;
const MAX_EXTRA_PAGES = 10;
const EXTRA_PAGE_CONCURRENCY = 3;
/** Extra pages stop this long before the crawl's ceiling, so running out of time costs them, not the crawl. */
const EXTRA_PAGES_SLACK_MS = 1_000;
const HOME_TEXT_CHARS = 12_000;
const EXTRA_TEXT_CHARS = 6_000;

const toCrawledPage = (url: string, page: ExtractedPage): CrawledPage => ({
  url,
  title: page.title,
  description: page.description,
  headings: page.headings,
  text: page.text,
});

const bareHost = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/**
 * The defendant is the submitted site: a homepage that redirects to another
 * site (acme.com → stripe.com) would otherwise be judged — and listed — on
 * someone else's content. Moving between a domain and its subdomains
 * (acme.com → app.acme.com) is fine.
 */
const ensureSameSite = (requested: string, final: string) => {
  const from = bareHost(requested);
  const to = bareHost(final);
  return from === to || to.endsWith(`.${from}`) || from.endsWith(`.${to}`)
    ? Effect.void
    : Effect.fail(new CrawlError({ url: requested, reason: "offsite", message: `redirects to ${to}` }));
};

// ---------------------------------------------------------------------------
// Sibling addresses
// ---------------------------------------------------------------------------

/** Second-level labels under which country registries sell names: acme.co.uk, acme.com.au. */
const SECOND_LEVEL_LABELS = new Set([
  "ac", "biz", "co", "com", "edu", "firm", "gen", "gov", "info", "ltd", "me", "ne", "net", "nom", "or", "org", "plc", "web",
]);

/** A registrable-looking name (`acme.com`, `acme.co.uk`), never `app.acme.com`, an IP or `localhost`. */
const isBareDomain = (host: string): boolean => {
  if (/^[\d.]+$/.test(host)) return false;
  const labels = host.split(".");
  if (labels.length === 2) return labels.every((label) => label.length > 0);
  return labels.length === 3 && /^[a-z]{2}$/.test(labels[2]!) && SECOND_LEVEL_LABELS.has(labels[1]!);
};

/**
 * Other addresses the same homepage may answer on, in the order worth
 * trying: `www.` dropped or added (added only to a bare domain), then, with
 * `plainHttp`, the same host over http when `url` is https. Path and query
 * are kept.
 */
export const siblingAddresses = (url: string, options: { readonly plainHttp: boolean }): Array<string> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const host = parsed.hostname.toLowerCase();
  const siblings: Array<string> = [];
  const toggled = host.startsWith("www.") ? host.slice(4) : isBareDomain(host) ? `www.${host}` : undefined;
  if (toggled !== undefined && toggled.includes(".")) {
    const sibling = new URL(parsed);
    sibling.hostname = toggled;
    siblings.push(sibling.href);
  }
  if (options.plainHttp && parsed.protocol === "https:") {
    const plain = new URL(parsed);
    plain.protocol = "http:";
    siblings.push(plain.href);
  }
  return siblings;
};

// ---------------------------------------------------------------------------
// Retry policies
// ---------------------------------------------------------------------------

/** How patiently one address is fetched. */
interface Patience {
  /** Budget per attempt; one attempt per entry, so later attempts may wait longer. */
  readonly timeouts: ReadonlyArray<Duration.Input>;
  /** First pause between attempts; it doubles each time, with jitter. */
  readonly backoff: Duration.Input;
}

interface HomePolicy {
  /** For the address as given. */
  readonly patience: Patience;
  /** For each sibling address, tried only once the given address has failed transiently. */
  readonly siblingPatience: Patience;
  /** Also try plain http when an https address keeps failing. */
  readonly plainHttp: boolean;
}

/** Timeouts, dropped connections and busy statuses; a bad certificate stays bad. */
const worthRetrying = (error: CrawlError): boolean => isTransientCrawlError(error) && !isTlsCrawlError(error);

/** Fails with a "timeout" for `url` once `effect` has run for `ceiling`. */
const withCeiling = <A>(effect: Effect.Effect<A, CrawlError>, url: string, ceiling: Duration.Input, what: string) =>
  Effect.timeoutOrElse(effect, {
    duration: ceiling,
    orElse: () =>
      Effect.fail(
        new CrawlError({
          url,
          reason: "timeout",
          message: `${what} did not finish within ${Duration.format(Duration.fromInputUnsafe(ceiling))}`,
        }),
      ),
  });

/**
 * Builds the crawler service. Uses only web-standard APIs (global `fetch`,
 * streams, TextDecoder), so it runs on Cloudflare Workers as well as Node.
 */
export const makeCrawler = (options: CrawlerOptions): Crawler["Service"] => {
  const homeTimeouts =
    options.homeTimeouts !== undefined && options.homeTimeouts.length > 0 ? options.homeTimeouts : DEFAULT_HOME_TIMEOUTS;
  const pageTimeout = options.pageTimeout ?? DEFAULT_PAGE_TIMEOUT;
  const retryBackoff = options.retryBackoff ?? DEFAULT_RETRY_BACKOFF;
  const quickRetryBackoff = options.quickRetryBackoff ?? DEFAULT_QUICK_RETRY_BACKOFF;
  const crawlCeiling = options.crawlCeiling ?? DEFAULT_CRAWL_CEILING;
  const crawlCeilingMs = Duration.toMillis(Duration.fromInputUnsafe(crawlCeiling));
  const preflightTimeout = options.preflightTimeout ?? DEFAULT_PREFLIGHT_TIMEOUT;
  const preflightCeiling = options.preflightCeiling ?? DEFAULT_PREFLIGHT_CEILING;
  const fetchPage = makePageFetcher({
    userAgent: options.userAgent,
    resolve: options.resolve ?? makeDohResolver(),
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });

  // Worst case with the defaults: 62 s of attempts plus ~3 s of backoff on the
  // address as given, ~33 s on each of two siblings (a dead site fails here,
  // after ~2.2 minutes), then ~25 s for the extra pages: about 2.6 minutes,
  // inside the 3-minute ceiling.
  const crawlHome: HomePolicy = {
    patience: { timeouts: homeTimeouts, backoff: retryBackoff },
    siblingPatience: { timeouts: homeTimeouts.length > 1 ? homeTimeouts.slice(0, -1) : homeTimeouts, backoff: retryBackoff },
    plainHttp: true,
  };
  const extraPage: Patience = { timeouts: [pageTimeout, pageTimeout], backoff: quickRetryBackoff };
  // Fast failures (refused, busy, TLS) leave room for the www sibling; a site that
  // hangs runs into the ceiling instead.
  const preflightHome: HomePolicy = {
    patience: { timeouts: [preflightTimeout, preflightTimeout], backoff: quickRetryBackoff },
    siblingPatience: { timeouts: [preflightTimeout], backoff: quickRetryBackoff },
    plainHttp: false,
  };

  /**
   * `fetchPage` with retries for failures worth retrying. Attempt n gets
   * `timeouts[n]`, with jittered exponential backoff in between.
   */
  const fetchPatiently = (url: string, { timeouts, backoff }: Patience): Effect.Effect<FetchedPage, CrawlError> =>
    Effect.gen(function* () {
      const { attempt } = yield* Schedule.CurrentMetadata;
      return yield* fetchPage(url, timeouts[Math.min(attempt, timeouts.length - 1)]!).pipe(
        Effect.tapError((error) => Effect.logDebug("Page attempt failed", { url, attempt, reason: error.reason })),
      );
    }).pipe(
      Effect.retry({
        schedule: Schedule.max([Schedule.exponential(backoff).pipe(Schedule.jittered), Schedule.recurs(timeouts.length - 1)]),
        while: worthRetrying,
      }),
    );

  /**
   * Loads the homepage, patiently. If the address still fails in a way
   * another address might not (timeout, refused, TLS, busy), tries its
   * siblings in turn; a sibling's page must still be on the same site. Fails
   * with the error for `url` itself: that is the address the buyer gave.
   */
  const fetchHome = Effect.fn("Crawler.fetchHome")(function* (url: string, policy: HomePolicy) {
    const load = (address: string, patience: Patience) =>
      fetchPatiently(address, patience).pipe(Effect.tap((page) => ensureSameSite(url, page.url)));
    return yield* load(url, policy.patience).pipe(
      Effect.catchIf(isTransientCrawlError, (error) =>
        Effect.firstSuccessOf([
          ...siblingAddresses(url, { plainHttp: policy.plainHttp }).map((sibling) =>
            Effect.logInfo("Homepage failed, trying a sibling address", { url, sibling, reason: error.reason }).pipe(
              Effect.andThen(load(sibling, policy.siblingPatience)),
            ),
          ),
          Effect.fail(error),
        ]),
      ),
    );
  });

  const preflight = Effect.fn("Crawler.preflight")(
    function* (url: string) {
      const page = yield* fetchHome(url, preflightHome);
      return { finalUrl: page.url };
    },
    (effect, url) => withCeiling(effect, url, preflightCeiling, "the site check"),
  );

  const crawl = Effect.fn("Crawler.crawl")(
    function* (url: string, crawlOptions?: CrawlOptions) {
      const deadline = (yield* Clock.currentTimeMillis) + crawlCeilingMs;
      const maxExtraPages = Math.max(0, Math.min(crawlOptions?.maxExtraPages ?? DEFAULT_EXTRA_PAGES, MAX_EXTRA_PAGES));

      // The homepage must load; everything else is best effort.
      const home = yield* fetchHome(url, crawlHome);
      const homePage = extractPage(home.html, home.url, HOME_TEXT_CHARS);

      // Extra pages share whatever time the homepage left; those still loading then are skipped.
      const targets = selectLinks(homePage.links, { pageUrl: home.url, scopeUrl: url, max: maxExtraPages });
      const extras: Array<CrawledPage | undefined> = targets.map(() => undefined);
      const timeLeft = deadline - EXTRA_PAGES_SLACK_MS - (yield* Clock.currentTimeMillis);
      yield* Effect.forEach(
        targets,
        (target, index) =>
          fetchPatiently(target, extraPage).pipe(
            Effect.map((page) => {
              extras[index] = toCrawledPage(page.url, extractPage(page.html, page.url, EXTRA_TEXT_CHARS));
            }),
            Effect.catch((error) => Effect.logDebug("Skipping extra page", { url: target, reason: error.reason })),
          ),
        { concurrency: EXTRA_PAGE_CONCURRENCY, discard: true },
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(Math.max(0, timeLeft)),
          orElse: () => Effect.logDebug("Out of time for extra pages", { url }),
        }),
      );

      // Extra pages that redirected back home (or onto each other) are dropped.
      const pages: Array<CrawledPage> = [toCrawledPage(home.url, homePage)];
      const seen = new Set([pageKey(home.url)]);
      for (const extra of extras) {
        if (extra === undefined || seen.has(pageKey(extra.url))) continue;
        seen.add(pageKey(extra.url));
        pages.push(extra);
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
    },
    (effect, url) => withCeiling(effect, url, crawlCeiling, "the crawl"),
  );

  return Crawler.of({ preflight, crawl });
};

/** A crawler layer with explicit options (tests: fake `resolve` or `fetch`, or `allowPrivateNetwork: true`). */
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
