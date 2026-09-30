import { Effect, Layer } from "effect";
import { AppConfig } from "../config";
import { Crawler } from "../services/Crawler";
import { makeCrawler } from "../services/crawler/CrawlerLive";
import { type BrowserRunContent, makeBrowserRenderer } from "../services/crawler/render";
import { CloudflareEnv } from "./env";

/**
 * The production crawler on Workers: plain HTTP first, and Browser Run
 * (the `BROWSER` binding) for homepages that are empty until JavaScript runs.
 * Without the binding it's the plain crawler.
 */
export const CrawlerCloudflare: Layer.Layer<Crawler, never, AppConfig | CloudflareEnv> = Layer.effect(
  Crawler,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const { BROWSER } = yield* CloudflareEnv;
    // workers-types and the DOM lib each declare their own Response; at runtime it's the same object.
    const browser: BrowserRunContent | undefined = BROWSER && {
      quickAction: (action, options) => BROWSER.quickAction(action, options) as unknown as Promise<Response>,
    };
    return makeCrawler({
      userAgent: config.crawlUserAgent,
      ...(browser ? { render: makeBrowserRenderer(browser, { userAgent: config.crawlUserAgent }) } : {}),
    });
  }),
);
