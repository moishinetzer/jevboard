import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { CrawlError } from "~/.server/domain/errors";
import { CustomerId } from "~/.server/domain/ids";
import { backfillIcons } from "~/.server/flows/maintenance";
import { Board } from "~/.server/services/Board";
import { Crawler } from "~/.server/services/Crawler";
import { crawlerLayer } from "~/.server/services/crawler/CrawlerLive";
import type { HttpFetch } from "~/.server/services/crawler/fetch";
import { MAX_ICON_BYTES, sniffImageType } from "~/.server/services/crawler/icon";
import { Icons } from "~/.server/services/Icons";
import { Orders } from "~/.server/services/Orders";
import { Pipeline } from "~/.server/services/Pipeline";
import { makeTestLayer, RecordingPayments, type Script, snapshotFor } from "./support/layers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const text = (value: string) => new TextEncoder().encode(value);

describe("sniffImageType", () => {
  it("names plain pictures by their first bytes", () => {
    assert.strictEqual(sniffImageType(PNG), "image/png");
    assert.strictEqual(sniffImageType(JPEG), "image/jpeg");
    assert.strictEqual(sniffImageType(text("GIF89a....")), "image/gif");
    assert.strictEqual(sniffImageType(text("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.strictEqual(sniffImageType(new Uint8Array([0, 0, 1, 0, 1, 0])), "image/x-icon");
  });

  it("refuses SVG, HTML and anything else", () => {
    assert.isNull(sniffImageType(text(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)));
    assert.isNull(sniffImageType(text("<!doctype html><title>Not found</title>")));
    assert.isNull(sniffImageType(text("RIFF\0\0\0\0WAVEfmt ")));
    assert.isNull(sniffImageType(new Uint8Array(0)));
  });
});

describe("Crawler.fetchIcon", () => {
  const answer = (body: Uint8Array, contentType: string) => async () => new Response(body.slice(), { headers: { "content-type": contentType } });
  const crawlerWith = (answers: Record<string, () => Promise<Response>>) => {
    const requested: Array<string> = [];
    const fetch: HttpFetch = (url) => {
      requested.push(url.href);
      return (answers[url.href] ?? (async () => new Response(null, { status: 404 })))();
    };
    const layer = crawlerLayer({ userAgent: "JevBot/test", resolve: () => Effect.succeed(["93.184.216.34"]), fetch });
    return { layer, requested };
  };
  const fetchIcon = (url: string) =>
    Effect.gen(function* () {
      return yield* Effect.exit((yield* Crawler).fetchIcon(url));
    });

  it.effect("copies a picture, typed by its bytes whatever the server calls it", () => {
    const net = crawlerWith({
      "https://acme.com/apple.png": answer(PNG, "image/png"),
      "https://acme.com/mislabelled": answer(JPEG, "image/png"),
      "https://acme.com/moved.png": async () => new Response(null, { status: 302, headers: { location: "https://cdn.acme.com/a.png" } }),
      "https://cdn.acme.com/a.png": answer(PNG, "application/octet-stream"),
    });
    return Effect.gen(function* () {
      const crawler = yield* Crawler;
      const icon = yield* crawler.fetchIcon("https://acme.com/apple.png");
      assert.strictEqual(icon.contentType, "image/png");
      assert.deepStrictEqual([...icon.bytes], [...PNG]);
      assert.strictEqual((yield* crawler.fetchIcon("https://acme.com/mislabelled")).contentType, "image/jpeg");
      assert.strictEqual((yield* crawler.fetchIcon("https://acme.com/moved.png")).contentType, "image/png");
    }).pipe(Effect.provide(net.layer));
  });

  it.effect("refuses SVG, pages, oversized files and addresses the guard blocks", () => {
    const svg = text(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
    const huge = new Uint8Array(MAX_ICON_BYTES + 1);
    huge.set(PNG);
    const net = crawlerWith({
      "https://acme.com/logo.svg": answer(svg, "image/svg+xml"),
      "https://acme.com/sneaky.png": answer(svg, "image/png"),
      "https://acme.com/page": answer(text("<html></html>"), "text/html"),
      "https://acme.com/huge.png": answer(huge, "image/png"),
      "https://acme.com/inside.png": async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    });
    return Effect.gen(function* () {
      for (const path of ["logo.svg", "sneaky.png", "page", "huge.png", "inside.png", "missing.png"]) {
        assert.isTrue(Exit.isFailure(yield* fetchIcon(`https://acme.com/${path}`)), path);
      }
      assert.isFalse(net.requested.some((url) => url.includes("169.254")));
      assert.isTrue(Exit.isFailure(yield* fetchIcon("http://localhost/icon.png")));
    }).pipe(Effect.provide(net.layer));
  });
});

// ---------------------------------------------------------------------------
// The board's own copies
// ---------------------------------------------------------------------------

const customer = CustomerId.make("cTestCustomer0000000000");
const script = (partial: Partial<Script>): Script => ({ scores: {}, strength: {}, duels: 0, ...partial });

/** A crawler whose sites all point at /apple.png, served (or not) from `served`. */
const crawlerWithIcons = (served: { icons: Record<string, Uint8Array> }) =>
  Layer.succeed(
    Crawler,
    Crawler.of({
      preflight: (url) => Effect.succeed({ finalUrl: url }),
      crawl: (url) => {
        const host = new URL(url).hostname;
        return Effect.succeed({ ...snapshotFor(host), favicon: `https://${host}/apple.png` });
      },
      fetchIcon: (url) =>
        Effect.suspend(() => {
          const bytes = served.icons[new URL(url).hostname];
          return bytes
            ? Effect.succeed({ contentType: sniffImageType(bytes) ?? "image/png", bytes })
            : Effect.fail(new CrawlError({ url, reason: "http", message: "HTTP 404", status: 404 }));
        }),
    }),
  );

const judge = (siteKey: string) =>
  Effect.gen(function* () {
    const orders = yield* Orders;
    const order = yield* orders.create({ customerId: customer, siteKey, url: `https://${siteKey}/`, kind: "new", entryId: null });
    assert.isTrue(yield* orders.markPaid(order.id));
    yield* (yield* Pipeline).run(order.id);
  });

describe("the board's own copies of logos", () => {
  it.live("copies the icon when Jev judges a site, and the row points at the copy", () => {
    const s = script({ scores: { "alpha.com": [800, 700, 600], "bare.com": [500] } });
    const served = { icons: { "alpha.com": PNG } as Record<string, Uint8Array> };
    return Effect.gen(function* () {
      const board = yield* Board;
      const icons = yield* Icons;
      yield* judge("alpha.com");
      yield* judge("bare.com");

      const alpha = yield* board.getBySiteKey("alpha.com");
      assert.match(alpha.iconUrl ?? "", /^\/icon\/alpha\.com\?v=\d+$/);
      const copy = Option.getOrThrow(yield* icons.get("alpha.com"));
      assert.strictEqual(copy.contentType, "image/png");
      assert.deepStrictEqual([...copy.bytes], [...PNG]);
      assert.strictEqual(alpha.iconUrl, `/icon/alpha.com?v=${copy.version}`);

      // No usable icon: no copy, and never the site's own address.
      assert.isNull((yield* board.getBySiteKey("bare.com")).iconUrl);
      assert.isTrue(Option.isNone(yield* icons.get("bare.com")));

      // A rejudge while the site's icon is unreachable keeps the copy Jev already has.
      served.icons = {};
      yield* judge("alpha.com");
      assert.strictEqual((yield* board.getBySiteKey("alpha.com")).iconUrl, alpha.iconUrl);

      // A new logo replaces the copy and changes its address.
      served.icons = { "alpha.com": JPEG };
      yield* Effect.sleep("2 millis");
      yield* judge("alpha.com");
      const after = yield* board.getBySiteKey("alpha.com");
      assert.notStrictEqual(after.iconUrl, alpha.iconUrl);
      assert.strictEqual(Option.getOrThrow(yield* icons.get("alpha.com")).contentType, "image/jpeg");
    }).pipe(Effect.provide(makeTestLayer(s, [], RecordingPayments(s), crawlerWithIcons(served))));
  });

  it.effect("doesn't serve the icon of a site kept off the board", () => {
    const s = script({ scores: { "parked.com": [12] }, overrides: { "parked.com": { contentFlag: "parked" } } });
    return Effect.gen(function* () {
      yield* judge("parked.com");
      assert.isTrue(Option.isNone(yield* (yield* Icons).get("parked.com")));
    }).pipe(Effect.provide(makeTestLayer(s, [], RecordingPayments(s), crawlerWithIcons({ icons: { "parked.com": PNG } }))));
  });

  it.effect("the cron copies icons of entries placed before copies existed, once each", () => {
    const s = script({ scores: { "old.com": [800], "gone.com": [700] } });
    const served = { icons: {} as Record<string, Uint8Array> };
    return Effect.gen(function* () {
      const board = yield* Board;
      const sql = yield* SqlClient.SqlClient;
      yield* judge("old.com");
      yield* judge("gone.com");
      // As they were before this feature: an address from the crawl, no copy.
      yield* sql`UPDATE entries SET icon_version = NULL`;
      assert.isNull((yield* board.getBySiteKey("old.com")).iconUrl);

      served.icons = { "old.com": PNG };
      yield* backfillIcons;
      assert.match((yield* board.getBySiteKey("old.com")).iconUrl ?? "", /^\/icon\/old\.com\?v=\d+$/);
      assert.isNull((yield* board.getBySiteKey("gone.com")).iconUrl);
      assert.deepStrictEqual(yield* board.withoutIcon(10), []);
    }).pipe(Effect.provide(makeTestLayer(s, [], RecordingPayments(s), crawlerWithIcons(served))));
  });
});
