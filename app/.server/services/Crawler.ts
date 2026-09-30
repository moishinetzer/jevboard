import { Context, type Effect } from "effect";
import type { CrawlError } from "../domain/errors";
import type { SiteSnapshot } from "../domain/models";

export interface CrawlOptions {
  /** Maximum number of extra same-site pages to fetch after the homepage. Default 3. */
  readonly maxExtraPages?: number;
  /** Render a JavaScript-only homepage in a browser. Default true (free previews skip it to save browser capacity). */
  readonly render?: boolean;
  /**
   * When a JavaScript-only homepage can't be rendered, fail with a temporary
   * error instead of reading the empty shell. Paid judgments set it, so the
   * queue retries and then refunds rather than judging a blank page.
   */
  readonly requireRender?: boolean;
  /** Stop fetching extra pages after this long (the homepage still gets its own budget). Default: the crawl ceiling. */
  readonly extraPagesWithinMs?: number;
}

/**
 * Fetches a business website the way Jev "reads" it: the homepage plus a few
 * informative same-site pages (about, pricing, product, ...), reduced to
 * titles, headings and visible text.
 *
 * Every request goes through an SSRF guard: only http(s) on ports 80/443,
 * every hop's host must resolve to public IPs, redirects are re-validated,
 * bodies are size-capped and requests time out.
 */
export class Crawler extends Context.Service<
  Crawler,
  {
    /**
     * Cheap reachability check run before we take anyone's money:
     * resolves DNS, applies the SSRF guard and GETs the page (following redirects).
     * Succeeds with the final URL.
     */
    readonly preflight: (url: string) => Effect.Effect<{ readonly finalUrl: string }, CrawlError>;
    /** Full crawl producing the snapshot Jev judges. */
    readonly crawl: (url: string, options?: CrawlOptions) => Effect.Effect<SiteSnapshot, CrawlError>;
  }
>()("jevboard/Crawler") {}
