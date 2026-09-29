import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AppConfig } from "~/.server/config";
import { CrawlError } from "~/.server/domain/errors";
import { Crawler } from "~/.server/services/Crawler";
import { type CrawlerOptions, CrawlerLive, crawlerLayer } from "~/.server/services/crawler/CrawlerLive";
import { MAX_BODY_BYTES, makePageFetcher } from "~/.server/services/crawler/fetch";
import { makeDohResolver, type Resolver } from "~/.server/services/crawler/ssrf";

/**
 * End-to-end crawls against a local node:http server. Loopback is exactly
 * what the SSRF guard refuses, so these use `allowPrivateNetwork: true`,
 * except the tests proving that the default crawler refuses it.
 */

// ---------------------------------------------------------------------------
// Fixture server (site + fake DNS-over-HTTPS endpoint)
// ---------------------------------------------------------------------------

const requests: Array<{ readonly path: string; readonly headers: IncomingHttpHeaders }> = [];
const hits = (path: string) => requests.filter((request) => request.path === path).length;

const HUGE_TOTAL_BYTES = 32_000_000;
let hugeBytesSent = 0;

const send = (res: ServerResponse, status: number, headers: Record<string, string>, body?: string | Buffer) => {
  res.writeHead(status, headers);
  res.end(body);
};
const html = (res: ServerResponse, body: string) => send(res, 200, { "content-type": "text/html; charset=utf-8" }, body);

const HOME_HTML = `<!doctype html>
<html><head><title>Local Acme</title><meta name="description" content="A local test site"></head>
<body>
  <h1>Welcome</h1><p>We sell local rockets.</p>
  <a href="/pricing">Pricing</a> <a href="/about">About</a> <a href="/features">Features</a>
  <a href="/login">Log in</a> <a href="/customers">Customers</a>
</body></html>`;

type DnsRecord = { readonly type: number; readonly data: string };
const DNS: Record<string, { readonly status?: number; readonly A?: Array<DnsRecord>; readonly AAAA?: Array<DnsRecord> }> = {
  "public.jevtest.com": {
    A: [
      { type: 5, data: "edge.cdn.example." },
      { type: 1, data: "93.184.216.34" },
    ],
    AAAA: [{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }],
  },
  "loopback.jevtest.com": { A: [{ type: 1, data: "127.0.0.1" }] },
  "sneaky.jevtest.com": { A: [{ type: 1, data: "93.184.216.34" }], AAAA: [{ type: 28, data: "fd00::1" }] },
  "nx.jevtest.com": { status: 3 },
  "empty.jevtest.com": {},
  "servfail.jevtest.com": { status: 2 },
};
const dnsQueries: Array<string> = [];

const dohHandler = (url: URL, headers: IncomingHttpHeaders, res: ServerResponse) => {
  const name = url.searchParams.get("name") ?? "";
  const type = url.searchParams.get("type") as "A" | "AAAA";
  dnsQueries.push(`${name}/${type}`);
  if (headers.accept !== "application/dns-json") return send(res, 400, {});
  if (name === "broken.jevtest.com") return send(res, 500, {});
  if (name === "garbage.jevtest.com") return send(res, 200, { "content-type": "application/dns-json" }, '{"nope":1}');
  if (name === "hang.jevtest.com") return; // never answers
  const zone = DNS[name] ?? { status: 3 };
  const body = { Status: zone.status ?? 0, Answer: zone[type] };
  send(res, 200, { "content-type": "application/dns-json" }, JSON.stringify(body));
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  requests.push({ path: url.pathname, headers: req.headers });
  const self = `http://${req.headers.host}`;
  switch (url.pathname) {
    case "/dns-query":
      return dohHandler(url, req.headers, res);
    case "/":
      return html(res, HOME_HTML);
    case "/pricing":
      return html(res, "<title>Pricing</title><h1>Plans</h1><p>$5 per rocket.</p>");
    case "/about":
      return send(res, 301, { location: "/about-us" });
    case "/about-us":
      return html(res, "<title>About</title><p>Founded in a garage.</p>");
    case "/features":
      return send(res, 500, { "content-type": "text/html" }, "<h1>oops</h1>");
    case "/customers":
      return send(res, 302, { location: "/" });
    case "/login":
      return html(res, "<title>Login</title>");
    case "/start":
      return send(res, 302, { location: "/hop2" });
    case "/hop2":
      return send(res, 301, { location: "hop3" });
    case "/hop3":
      return send(res, 307, { location: `${self}/#landed` });
    case "/loop":
      return send(res, 302, { location: "/loop" });
    case "/elsewhere":
      // Same server, different host name: counts as a different site.
      return send(res, 301, { location: `${self.replace("127.0.0.1", "localhost")}/` });
    case "/no-location":
      return send(res, 302, {});
    case "/redirect-ftp":
      return send(res, 302, { location: "ftp://example.com/" });
    case "/redirect-creds":
      return send(res, 302, { location: `http://user:pw@${req.headers.host}/` });
    case "/json":
      return send(res, 200, { "content-type": "application/json" }, '{"ok":true}');
    case "/untyped-html":
      return send(res, 200, {}, "<!DOCTYPE html><title>Untyped</title>");
    case "/untyped-binary":
      return send(res, 200, {}, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00, 0xff]));
    case "/missing":
      return send(res, 404, { "content-type": "text/html" }, "not here");
    case "/latin1":
      return send(
        res,
        200,
        { "content-type": "text/html; charset=iso-8859-1" },
        Buffer.from("<title>Café Olé</title><p>Crème brûlée</p>", "latin1"),
      );
    case "/meta-charset":
      return send(
        res,
        200,
        { "content-type": "text/html" },
        Buffer.from('<meta charset="windows-1252"><title>Señor Taco</title>', "latin1"),
      );
    case "/gzip":
      return send(
        res,
        200,
        { "content-type": "text/html", "content-encoding": "gzip" },
        gzipSync("<title>Zipped</title><p>compressed body</p>"),
      );
    case "/huge": {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = `<p>${"lorem ipsum dolor sit amet ".repeat(2_000)}</p>`;
      hugeBytesSent = 0;
      const pump = () => {
        while (hugeBytesSent < HUGE_TOTAL_BYTES && !res.destroyed) {
          hugeBytesSent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      return pump();
    }
    case "/slow":
      return; // never answers
    default:
      return send(res, 404, {});
  }
});

let base = "";
beforeAll(
  () =>
    new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      }),
    ),
);
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const localOptions: CrawlerOptions = { userAgent: "JevBot/test", allowPrivateNetwork: true, pageTimeout: "5 seconds" };
const local = (options: Partial<CrawlerOptions> = {}) => crawlerLayer({ ...localOptions, ...options });

/** Fake DNS for the default (guarded) crawler; nothing here ever reaches the network. */
const fakeResolver =
  (zone: Record<string, ReadonlyArray<string>>): Resolver =>
  (hostname) =>
    zone[hostname] !== undefined
      ? Effect.succeed(zone[hostname])
      : Effect.fail(new CrawlError({ url: hostname, reason: "dns", message: `${hostname} does not exist` }));

const crawlError = <A, R>(effect: Effect.Effect<A, CrawlError, R>) => Effect.flip(effect);

// ---------------------------------------------------------------------------
// Crawling a local site
// ---------------------------------------------------------------------------

describe("crawl (local server, private network allowed)", () => {
  it.live("reads the homepage plus the best same-site pages", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const snapshot = yield* crawler.crawl(`${base}/`);

      assert.strictEqual(snapshot.requestedUrl, `${base}/`);
      assert.strictEqual(snapshot.finalUrl, `${base}/`);
      assert.strictEqual(snapshot.host, "127.0.0.1");
      assert.strictEqual(snapshot.title, "Local Acme");
      assert.strictEqual(snapshot.description, "A local test site");
      assert.isAbove(snapshot.fetchedAt, 0);
      // /features answers 500: skipped without failing the crawl. /about redirects.
      assert.deepStrictEqual(
        snapshot.pages.map((page) => page.url),
        [`${base}/`, `${base}/pricing`, `${base}/about-us`],
      );
      assert.include(snapshot.pages[0]!.text, "We sell local rockets.");
      assert.deepStrictEqual(snapshot.pages[1]!.headings, ["Plans"]);
      assert.strictEqual(hits("/login"), 0);

      const homeRequest = requests.find((request) => request.path === "/")!;
      assert.strictEqual(homeRequest.headers["user-agent"], "JevBot/test");
      assert.include(String(homeRequest.headers.accept), "text/html");
    }).pipe(Effect.provide(local())),
  );

  it.live("drops extra pages that redirect back home and honours maxExtraPages", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const before = hits("/customers");
      const wide = yield* crawler.crawl(`${base}/`, { maxExtraPages: 4 });
      assert.strictEqual(hits("/customers"), before + 1);
      assert.deepStrictEqual(
        wide.pages.map((page) => page.url),
        [`${base}/`, `${base}/pricing`, `${base}/about-us`],
      );
      const narrow = yield* crawler.crawl(`${base}/`, { maxExtraPages: 0 });
      assert.strictEqual(narrow.pages.length, 1);
    }).pipe(Effect.provide(local())),
  );

  it.live("follows relative and absolute redirects and reports the final URL", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      assert.deepStrictEqual(yield* crawler.preflight(`${base}/start`), { finalUrl: `${base}/` });
      const snapshot = yield* crawler.crawl(`${base}/start`);
      assert.strictEqual(snapshot.requestedUrl, `${base}/start`);
      assert.strictEqual(snapshot.finalUrl, `${base}/`);
    }).pipe(Effect.provide(local())),
  );

  it.live("refuses a homepage that redirects to a different site", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const preflight = yield* crawlError(crawler.preflight(`${base}/elsewhere`));
      assert.strictEqual(preflight.reason, "offsite");
      assert.match(preflight.message, /localhost/);
      assert.strictEqual((yield* crawlError(crawler.crawl(`${base}/elsewhere`))).reason, "offsite");
    }).pipe(Effect.provide(local())),
  );

  it.live("gives up after 5 redirects and on redirects without a Location", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const before = hits("/loop");
      const loop = yield* crawlError(crawler.crawl(`${base}/loop`));
      assert.strictEqual(loop.reason, "http");
      assert.strictEqual(loop.url, `${base}/loop`);
      assert.strictEqual(hits("/loop") - before, 6); // the request plus 5 redirects
      assert.strictEqual((yield* crawlError(crawler.preflight(`${base}/no-location`))).reason, "http");
    }).pipe(Effect.provide(local())),
  );

  it.live("re-validates every redirect hop", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const ftp = yield* crawlError(crawler.crawl(`${base}/redirect-ftp`));
      assert.strictEqual(ftp.reason, "blocked");
      assert.include(ftp.message, "ftp:");
      assert.strictEqual((yield* crawlError(crawler.crawl(`${base}/redirect-creds`))).reason, "blocked");
    }).pipe(Effect.provide(local())),
  );

  it.live("maps HTTP errors, non-HTML and dead ports", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const missing = yield* crawlError(crawler.crawl(`${base}/missing`));
      assert.strictEqual(missing.reason, "http");
      assert.strictEqual(missing.message, "HTTP 404");
      assert.strictEqual((yield* crawlError(crawler.preflight(`${base}/features`))).message, "HTTP 500");
      assert.strictEqual((yield* crawlError(crawler.crawl(`${base}/json`))).reason, "not-html");
      assert.strictEqual((yield* crawlError(crawler.crawl(`${base}/untyped-binary`))).reason, "not-html");
      assert.strictEqual((yield* crawler.crawl(`${base}/untyped-html`)).title, "Untyped");
      assert.strictEqual((yield* crawlError(crawler.crawl("http://127.0.0.1:1/"))).reason, "unreachable");
    }).pipe(Effect.provide(local())),
  );

  it.live("decodes declared and <meta> charsets and compressed bodies", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const latin1 = yield* crawler.crawl(`${base}/latin1`);
      assert.strictEqual(latin1.title, "Café Olé");
      assert.include(latin1.pages[0]!.text, "Crème brûlée");
      assert.strictEqual((yield* crawler.crawl(`${base}/meta-charset`)).title, "Señor Taco");
      assert.strictEqual((yield* crawler.crawl(`${base}/gzip`)).title, "Zipped");
    }).pipe(Effect.provide(local())),
  );

  it.live("truncates an oversized body and stops downloading", () =>
    Effect.gen(function* () {
      const fetchPage = makePageFetcher({
        userAgent: "JevBot/test",
        resolve: fakeResolver({}),
        allowPrivateNetwork: true,
      });
      const page = yield* fetchPage(`${base}/huge`, "10 seconds");
      assert.isTrue(page.truncated);
      assert.isAtMost(page.html.length, MAX_BODY_BYTES);
      assert.isBelow(hugeBytesSent, HUGE_TOTAL_BYTES);

      const snapshot = yield* (yield* Crawler).crawl(`${base}/huge`);
      assert.isAtMost(snapshot.pages[0]!.text.length, 12_000);
      assert.isAbove(snapshot.pages[0]!.text.length, 11_900);
    }).pipe(Effect.provide(local())),
  );

  it.live("times out slow pages", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const slow = yield* crawlError(crawler.crawl(`${base}/slow`));
      assert.strictEqual(slow.reason, "timeout");
      assert.strictEqual((yield* crawlError(crawler.preflight(`${base}/slow`))).reason, "timeout");
    }).pipe(Effect.provide(local({ pageTimeout: "300 millis", preflightTimeout: "300 millis" }))),
  );
});

// ---------------------------------------------------------------------------
// The SSRF guard with the default settings
// ---------------------------------------------------------------------------

describe("SSRF guard (default crawler)", () => {
  it.live("CrawlerLive refuses loopback without sending a request", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      const before = requests.length;
      for (const url of [`${base}/`, "http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://169.254.169.254/"]) {
        const error = yield* crawlError(crawler.crawl(url));
        assert.strictEqual(error.reason, "blocked", url);
        assert.strictEqual(error.url, url);
      }
      assert.strictEqual((yield* crawlError(crawler.preflight(`${base}/`))).reason, "blocked");
      assert.strictEqual(requests.length, before);
    }).pipe(Effect.provide(CrawlerLive.pipe(Layer.provide(AppConfig.layerTest())))),
  );

  it.live("refuses names that resolve to any private address", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      for (const host of ["rebind.jevtest.com", "mapped.jevtest.com", "metadata.jevtest.com"]) {
        const url = `https://${host}/`;
        const error = yield* crawlError(crawler.crawl(url));
        assert.strictEqual(error.reason, "blocked", host);
        assert.strictEqual(error.url, url);
      }
      const dns = yield* crawlError(crawler.preflight("https://nx.jevtest.com/"));
      assert.strictEqual(dns.reason, "dns");
      assert.strictEqual(dns.url, "https://nx.jevtest.com/");
    }).pipe(
      Effect.provide(
        crawlerLayer({
          userAgent: "JevBot/test",
          resolve: fakeResolver({
            "rebind.jevtest.com": ["93.184.216.34", "10.0.0.1"],
            "mapped.jevtest.com": ["::ffff:127.0.0.1"],
            "metadata.jevtest.com": ["169.254.169.254"],
          }),
        }),
      ),
    ),
  );

  it.live("checks DNS-over-HTTPS answers end to end", () =>
    Effect.gen(function* () {
      const crawler = yield* Crawler;
      assert.strictEqual((yield* crawlError(crawler.crawl("https://loopback.jevtest.com/"))).reason, "blocked");
      assert.strictEqual((yield* crawlError(crawler.crawl("https://sneaky.jevtest.com/"))).reason, "blocked");
      assert.strictEqual((yield* crawlError(crawler.crawl("https://nx.jevtest.com/"))).reason, "dns");
    }).pipe(
      Effect.provide(
        Layer.suspend(() =>
          crawlerLayer({ userAgent: "JevBot/test", resolve: makeDohResolver({ endpoint: `${base}/dns-query` }) }),
        ),
      ),
    ),
  );
});

describe("makeDohResolver", () => {
  it.live("returns A and AAAA addresses (not CNAMEs) and caches them", () =>
    Effect.gen(function* () {
      const resolve = makeDohResolver({ endpoint: `${base}/dns-query` });
      assert.deepStrictEqual(yield* resolve("public.jevtest.com"), ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
      const queries = dnsQueries.length;
      yield* resolve("PUBLIC.jevtest.com");
      assert.strictEqual(dnsQueries.length, queries);
      assert.deepStrictEqual(yield* resolve("loopback.jevtest.com"), ["127.0.0.1"]);
    }),
  );

  it.live("maps NXDOMAIN, empty answers and SERVFAIL to dns, broken resolvers to unreachable/timeout", () =>
    Effect.gen(function* () {
      const resolve = makeDohResolver({ endpoint: `${base}/dns-query`, timeout: "300 millis" });
      for (const host of ["nx.jevtest.com", "empty.jevtest.com", "servfail.jevtest.com"]) {
        assert.strictEqual((yield* Effect.flip(resolve(host))).reason, "dns", host);
      }
      for (const host of ["broken.jevtest.com", "garbage.jevtest.com"]) {
        assert.strictEqual((yield* Effect.flip(resolve(host))).reason, "unreachable", host);
      }
      assert.strictEqual((yield* Effect.flip(resolve("hang.jevtest.com"))).reason, "timeout");
    }),
  );
});

// ---------------------------------------------------------------------------
// Live smoke test against the real internet (opt-in: JEV_LIVE_TESTS=1)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.JEV_LIVE_TESTS)("live crawl (JEV_LIVE_TESTS=1)", () => {
  const live = crawlerLayer({ userAgent: "Mozilla/5.0 (compatible; JevBot/1.0; +https://jevboard.com/faq#jevbot)" });

  it.live(
    "crawls example.com and github.com through the full guard",
    () =>
      Effect.gen(function* () {
        const crawler = yield* Crawler;
        const example = yield* crawler.crawl("https://example.com/");
        assert.strictEqual(example.title, "Example Domain");
        assert.strictEqual(example.host, "example.com");
        const github = yield* crawler.preflight("http://github.com/");
        assert.strictEqual(github.finalUrl, "https://github.com/");
        const nx = yield* crawlError(crawler.preflight("https://this-domain-does-not-exist-jevboard-7f3a.com/"));
        assert.strictEqual(nx.reason, "dns");
      }).pipe(Effect.provide(live)),
    30_000,
  );
});
