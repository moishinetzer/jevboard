import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import type { Env } from "~/.server/cloudflare/env";
import { proxyPostHog } from "../workers/posthog-proxy";

const env = { POSTHOG_TOKEN: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com" } as unknown as Env;

describe("the PostHog proxy (/rbj)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const forward = async (path: string) => {
    const targets: Array<string> = [];
    vi.stubGlobal("fetch", async (target: URL) => {
      targets.push(String(target));
      return new Response("ok", { headers: { "set-cookie": "session=1; Path=/" } });
    });
    const response = await proxyPostHog(new Request(`https://rankedbyjev.com${path}`), env);
    return { target: targets[0], response };
  };

  it("only ever talks to PostHog, whatever the path says", async () => {
    for (const path of ["/rbj//example.com/pay.html", "/rbj/\\\\example.com/pay.html", "/rbj/..//example.com/", "/rbj//@example.com/"]) {
      const { target } = await forward(path);
      if (target) assert.match(target, /^https:\/\/eu(-assets)?\.i\.posthog\.com\//, `${path} went to ${target}`);
    }
  });

  it("forwards events and SDK assets, without letting PostHog set cookies on our domain", async () => {
    const events = await forward("/rbj/e/?ip=1");
    assert.strictEqual(events.target, "https://eu.i.posthog.com/e/?ip=1");
    assert.isNull(events.response?.headers.get("set-cookie") ?? null);
    const assets = await forward("/rbj/static/array.js");
    assert.strictEqual(assets.target, "https://eu-assets.i.posthog.com/static/array.js");
  });

  it("leaves every other path to the app", async () => {
    assert.isUndefined(proxyPostHog(new Request("https://rankedbyjev.com/rbjx"), env));
    assert.isUndefined(proxyPostHog(new Request("https://rankedbyjev.com/"), env));
  });
});
