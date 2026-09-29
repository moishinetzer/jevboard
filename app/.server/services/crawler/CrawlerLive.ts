import { Effect, Layer } from "effect";
import { CrawlError } from "../../domain/errors";
import { Crawler } from "../Crawler";

// PLACEHOLDER — replaced by the real SSRF-safe crawler implementation.
export const CrawlerLive = Layer.succeed(
  Crawler,
  Crawler.of({
    preflight: (url) => Effect.fail(new CrawlError({ url, reason: "unreachable", message: "crawler not implemented" })),
    crawl: (url) => Effect.fail(new CrawlError({ url, reason: "unreachable", message: "crawler not implemented" })),
  }),
);
