import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { Env } from "~/.server/cloudflare/env";
import { AppConfig } from "~/.server/config";
import { Analytics, AnalyticsActor, track } from "~/.server/services/Analytics";
import { proxyPostHog } from "../workers/posthog-proxy";

interface Sent {
  readonly url: string;
  readonly body: { readonly api_key: string; readonly batch: ReadonlyArray<Record<string, any>> };
}

const fakeHttp = (status = 200) => {
  const sent: Array<Sent> = [];
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const raw = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}";
      sent.push({ url: url.href, body: JSON.parse(raw) });
      return HttpClientResponse.fromWeb(request, new Response("{}", { status }));
    }),
  );
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const analyticsWith = (http: ReturnType<typeof fakeHttp>, token: string | null) =>
  Analytics.layerNoDeps.pipe(
    Layer.provide(http.layer),
    Layer.provide(
      AppConfig.layerTest({
        posthog: token ? Option.some({ token, host: "https://eu.i.posthog.test" }) : Option.none(),
      }),
    ),
  );

describe("Analytics", () => {
  it.effect("batches events for the current visitor and sends them on flush", () => {
    const http = fakeHttp();
    return Effect.gen(function* () {
      const analytics = yield* Analytics;
      yield* analytics
        .capture("checkout_started", { site: "acme.com" })
        .pipe(Effect.provideService(AnalyticsActor, { distinctId: "cVisitor", sessionId: "sess-1" }));
      yield* analytics.capture("payment_confirmed", { via: "webhook" }, { distinctId: "cBuyer" });
      yield* analytics.capture("maintenance_ran");
      assert.strictEqual(http.sent.length, 0);

      yield* analytics.flush;
      assert.strictEqual(http.sent.length, 1);
      const [request] = http.sent;
      assert.strictEqual(request!.url, "https://eu.i.posthog.test/batch/");
      assert.strictEqual(request!.body.api_key, "phc_test");
      const [checkout, paid, server] = request!.body.batch;
      assert.strictEqual(checkout!.event, "checkout_started");
      assert.strictEqual(checkout!.distinct_id, "cVisitor");
      assert.strictEqual(checkout!.properties.$session_id, "sess-1");
      assert.strictEqual(checkout!.properties.site, "acme.com");
      assert.strictEqual(paid!.distinct_id, "cBuyer");
      // No person to attach a server-side event to: no person profile either.
      assert.strictEqual(server!.properties.$process_person_profile, false);

      // Nothing left to send.
      yield* analytics.flush;
      assert.strictEqual(http.sent.length, 1);
    }).pipe(Effect.provide(analyticsWith(http, "phc_test")));
  });

  it.effect("never fails the caller when PostHog is down", () => {
    const http = fakeHttp(503);
    return Effect.gen(function* () {
      const analytics = yield* Analytics;
      yield* analytics.capture("judgment_completed");
      yield* analytics.flush;
      assert.strictEqual(http.sent.length, 1);
    }).pipe(Effect.provide(analyticsWith(http, "phc_test")));
  });

  it.effect("does nothing without a PostHog token", () => {
    const http = fakeHttp();
    return Effect.gen(function* () {
      const analytics = yield* Analytics;
      yield* analytics.capture("checkout_started");
      yield* analytics.flush;
      assert.strictEqual(http.sent.length, 0);
    }).pipe(Effect.provide(analyticsWith(http, null)));
  });

  it.effect("track is a no-op where Analytics isn't provided", () => track("anything", { a: 1 }));
});

describe("proxyPostHog (/rbj)", () => {
  const env = { POSTHOG_TOKEN: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com" } as unknown as Env;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });
  const stubFetch = () =>
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      calls.push({ url: url.href, init });
      return new Response("ok");
    });

  it("leaves every other path to the app", () => {
    assert.isUndefined(proxyPostHog(new Request("https://rankedbyjev.com/"), env));
    assert.isUndefined(proxyPostHog(new Request("https://rankedbyjev.com/rbjx"), env));
    assert.isUndefined(proxyPostHog(new Request("https://rankedbyjev.com/rbj/e/"), {} as unknown as Env));
  });

  it("sends events to the ingestion host without our cookies, and SDK assets to the assets host", async () => {
    stubFetch();
    await proxyPostHog(
      new Request("https://rankedbyjev.com/rbj/e/?ver=1", {
        method: "POST",
        body: "{}",
        headers: { cookie: "jev_vid=secret", "cf-connecting-ip": "203.0.113.9" },
      }),
      env,
    );
    await proxyPostHog(new Request("https://rankedbyjev.com/rbj/static/array.js"), env);

    assert.strictEqual(calls[0]!.url, "https://eu.i.posthog.com/e/?ver=1");
    const headers = new Headers(calls[0]!.init.headers);
    assert.isNull(headers.get("cookie"));
    assert.strictEqual(headers.get("x-forwarded-for"), "203.0.113.9");
    assert.strictEqual(calls[0]!.init.method, "POST");
    assert.strictEqual(calls[1]!.url, "https://eu-assets.i.posthog.com/static/array.js");
  });
});
