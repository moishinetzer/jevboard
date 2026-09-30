import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { CrawlError } from "~/.server/domain/errors";
import { Crawler } from "~/.server/services/Crawler";
import { crawlerLayer } from "~/.server/services/crawler/CrawlerLive";
import type { HttpFetch } from "~/.server/services/crawler/fetch";
import { MAX_BODY_BYTES } from "~/.server/services/crawler/fetch";
import { extractPage } from "~/.server/services/crawler/html";
import {
  type BrowserRunContent,
  looksClientRendered,
  makeBrowserRenderer,
  type RenderPage,
} from "~/.server/services/crawler/render";

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** What a client-rendered app serves before its JavaScript runs. */
const SHELL = `<!doctype html><html><head><title>Rocketly</title><meta name="description" content="Rockets as a service">
<script type="module" src="/assets/index-3f2a.js"></script></head>
<body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;

const words = (count: number, word = "rockets") => Array.from({ length: count }, () => word).join(" ");

/** The same app after rendering: real copy and links to more pages. */
const RENDERED = `<!doctype html><html><head><title>Rocketly: rockets as a service</title></head>
<body><div id="root"><h1>Launch a rocket in five minutes</h1><p>${words(120, "Rocketly launches small payloads")}</p>
<a href="/pricing">Pricing</a> <a href="/about">About us</a> <a href="/customers">Customers</a></div></body></html>`;

const RENDERED_PRICING = `<title>Pricing</title><div id="root"><h1>Pricing</h1><p>${words(80, "$5 per launch")}</p></div>`;

/** A server-rendered page: all its words are in the HTML. */
const SERVER_RENDERED = `<!doctype html><title>Acme</title><h1>Acme rockets</h1><p>${words(200, "Acme builds rockets")}</p>
<a href="/pricing">Pricing</a>`;

// ---------------------------------------------------------------------------
// A scripted network and a scripted browser
// ---------------------------------------------------------------------------

const html = (body: string) =>
  Promise.resolve(new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }));

const scriptedNet = (pages: Record<string, string>) => {
  const requested: Array<string> = [];
  const fetch: HttpFetch = (url) => {
    requested.push(url.href);
    const body = pages[url.href];
    return body === undefined ? Promise.resolve(new Response(null, { status: 404 })) : html(body);
  };
  return { fetch, requested };
};

/** Renders from a table of URL → HTML (and records what it was asked for); anything else fails. */
const scriptedBrowser = (
  pages: Record<string, string | CrawlError>,
  finalUrl: (url: string) => string = (url) => url,
) => {
  const rendered: Array<string> = [];
  const render: RenderPage = (url) =>
    Effect.suspend(() => {
      rendered.push(url);
      const page = pages[url];
      if (page === undefined) return Effect.fail(new CrawlError({ url, reason: "http", message: "HTTP 404", status: 404 }));
      if (page instanceof CrawlError) return Effect.fail(page);
      return Effect.succeed({ url: finalUrl(url), html: page, truncated: false });
    });
  return { render, rendered };
};

const crawlerWith = (net: { readonly fetch: HttpFetch }, render?: RenderPage) =>
  crawlerLayer({
    userAgent: "JevBot/test",
    resolve: () => Effect.succeed(["93.184.216.34"]),
    fetch: net.fetch,
    homeTimeouts: ["1 second"],
    pageTimeout: "1 second",
    retryBackoff: "1 millis",
    quickRetryBackoff: "1 millis",
    ...(render ? { render } : {}),
  });

// ---------------------------------------------------------------------------

describe("looksClientRendered", () => {
  const check = (source: string) => looksClientRendered(source, extractPage(source, "https://x.test/", 12_000));

  it("spots an empty app shell", () => {
    assert.isTrue(check(SHELL));
    assert.isTrue(check(`<title>App</title><div id="app"></div>`));
    assert.isTrue(check(`<title>App</title><body><div id="__next"></div></body>`));
  });

  it("spots sparse pages that ask for JavaScript or mount into an empty root", () => {
    const sparse = `<p>${words(60)}</p>`;
    assert.isTrue(check(`${sparse}<noscript>Please enable JavaScript to continue.</noscript>`));
    assert.isTrue(check(`${sparse}<div id="root"></div>`));
  });

  it("leaves server-rendered pages alone, small ones included", () => {
    assert.isFalse(check(SERVER_RENDERED));
    // A short landing page with its words in the HTML: sparse, but no app root and no JavaScript notice.
    assert.isFalse(check(`<h1>Tiny Bakery</h1><p>${words(70, "fresh bread daily")}</p>`));
    // Plenty of text wins over a leftover noscript tag.
    assert.isFalse(check(`${SERVER_RENDERED}<noscript>Enable JavaScript for the map.</noscript>`));
  });
});

describe("crawl with a browser for client-rendered sites", () => {
  it.effect("renders an empty app shell, then its extra pages, in the browser", () => {
    const net = scriptedNet({ "https://rocketly.app/": SHELL });
    const browser = scriptedBrowser({
      "https://rocketly.app/": RENDERED,
      "https://rocketly.app/pricing": RENDERED_PRICING,
      "https://rocketly.app/about": `<h1>About</h1><p>${words(50, "we love rockets")}</p>`,
      "https://rocketly.app/customers": `<h1>Customers</h1>`,
    });
    return Effect.gen(function* () {
      const snapshot = yield* (yield* Crawler).crawl("https://rocketly.app/");
      assert.match(snapshot.pages[0]!.text, /Rocketly launches small payloads/);
      assert.include(snapshot.pages[0]!.headings, "Launch a rocket in five minutes");
      assert.strictEqual(snapshot.title, "Rocketly: rockets as a service");
      // Two extra pages at most for a rendered site, both through the browser.
      assert.strictEqual(snapshot.pages.length, 3);
      assert.strictEqual(browser.rendered.length, 3);
      assert.deepStrictEqual(net.requested, ["https://rocketly.app/"]);
      assert.isTrue(snapshot.pages.some((page) => /\$5 per launch/.test(page.text)));
    }).pipe(Effect.provide(crawlerWith(net, browser.render)));
  });

  it.effect("never starts a browser for a server-rendered site", () => {
    const net = scriptedNet({ "https://acme.com/": SERVER_RENDERED, "https://acme.com/pricing": RENDERED_PRICING });
    const browser = scriptedBrowser({});
    return Effect.gen(function* () {
      const snapshot = yield* (yield* Crawler).crawl("https://acme.com/");
      assert.strictEqual(snapshot.pages.length, 2);
      assert.deepStrictEqual(browser.rendered, []);
    }).pipe(Effect.provide(crawlerWith(net, browser.render)));
  });

  it.live("judges the plain shell when the browser fails, instead of failing the crawl", () => {
    const net = scriptedNet({ "https://rocketly.app/": SHELL });
    const busy = new CrawlError({ url: "https://rocketly.app/", reason: "unreachable", message: "renderer busy (429)" });
    const browser = scriptedBrowser({ "https://rocketly.app/": busy });
    return Effect.gen(function* () {
      const snapshot = yield* (yield* Crawler).crawl("https://rocketly.app/");
      assert.strictEqual(snapshot.title, "Rocketly");
      assert.strictEqual(snapshot.description, "Rockets as a service");
      // One retry for a busy renderer, then the plain page.
      assert.strictEqual(browser.rendered.length, 2);
    }).pipe(Effect.provide(crawlerWith(net, browser.render)));
  });

  it.effect("ignores a render that ends up on another site", () => {
    const net = scriptedNet({ "https://rocketly.app/": SHELL });
    const browser = scriptedBrowser({ "https://rocketly.app/": RENDERED }, () => "https://elsewhere.com/");
    return Effect.gen(function* () {
      const snapshot = yield* (yield* Crawler).crawl("https://rocketly.app/");
      assert.strictEqual(snapshot.finalUrl, "https://rocketly.app/");
      assert.notMatch(snapshot.pages[0]!.text, /Rocketly launches/);
    }).pipe(Effect.provide(crawlerWith(net, browser.render)));
  });

  it.effect("without a browser, a shell is judged as it is", () => {
    const net = scriptedNet({ "https://rocketly.app/": SHELL });
    return Effect.gen(function* () {
      const snapshot = yield* (yield* Crawler).crawl("https://rocketly.app/");
      assert.strictEqual(snapshot.pages.length, 1);
      assert.strictEqual(snapshot.title, "Rocketly");
    }).pipe(Effect.provide(crawlerWith(net)));
  });
});

describe("makeBrowserRenderer (Browser Run content action)", () => {
  const binding = (reply: () => Response) => {
    const calls: Array<Parameters<BrowserRunContent["quickAction"]>> = [];
    const browser: BrowserRunContent = {
      quickAction: (action, options) => {
        calls.push([action, options]);
        return Promise.resolve(reply());
      },
    };
    return { browser, calls };
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it.effect("asks as JevBot for the rendered HTML, without images, and keeps the final URL", () => {
    const { browser, calls } = binding(() =>
      json({ success: true, result: RENDERED, meta: { status: 200, title: "Rocketly", finalUrl: "https://www.rocketly.app/" } }),
    );
    return Effect.gen(function* () {
      const page = yield* makeBrowserRenderer(browser, { userAgent: "JevBot/1.0" })("https://rocketly.app/");
      assert.strictEqual(page.url, "https://www.rocketly.app/");
      assert.strictEqual(page.html, RENDERED);
      const [action, options] = calls[0]!;
      assert.strictEqual(action, "content");
      assert.strictEqual(options.url, "https://rocketly.app/");
      assert.strictEqual(options.userAgent, "JevBot/1.0");
      assert.deepStrictEqual(options.rejectResourceTypes, ["image", "media", "font"]);
      assert.strictEqual(options.gotoOptions.waitUntil, "networkidle2");
    });
  });

  it.effect("the page's own error status is an http error", () => {
    const { browser } = binding(() => json({ success: true, result: "<h1>Not found</h1>", meta: { status: 404, title: "" } }));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(makeBrowserRenderer(browser, { userAgent: "JevBot/1.0" })("https://rocketly.app/"));
      assert.strictEqual(error.reason, "http");
      assert.strictEqual(error.status, 404);
    });
  });

  it.effect("a busy or failing renderer is unreachable (worth another try)", () => {
    const { browser } = binding(() => json({ success: false, errors: [{ message: "Rate limit exceeded" }] }, 429));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(makeBrowserRenderer(browser, { userAgent: "JevBot/1.0" })("https://rocketly.app/"));
      assert.strictEqual(error.reason, "unreachable");
      assert.match(error.message, /Rate limit exceeded/);
    });
  });

  it.effect("caps huge pages like the plain crawler does", () => {
    const huge = `<p>${"x".repeat(MAX_BODY_BYTES + 10)}</p>`;
    const { browser } = binding(() => json({ success: true, result: huge, meta: { status: 200, title: "" } }));
    return Effect.gen(function* () {
      const page = yield* makeBrowserRenderer(browser, { userAgent: "JevBot/1.0" })("https://rocketly.app/");
      assert.strictEqual(page.html.length, MAX_BODY_BYTES);
      assert.isTrue(page.truncated);
    });
  });
});
