import { assert, describe, it } from "@effect/vitest";
import { canonicalRedirect } from "../workers/canonical";

const PUBLIC = "https://rankedbyjev.com";
const to = (url: string, init?: RequestInit, publicUrl: string | undefined = PUBLIC) =>
  canonicalRedirect(new Request(url, init), publicUrl)?.headers.get("location") ?? null;

describe("one address for every page", () => {
  it("sends plain http, www and the workers.dev host to the public https address", () => {
    assert.strictEqual(to("http://rankedbyjev.com/"), "https://rankedbyjev.com/");
    assert.strictEqual(to("http://rankedbyjev.com/s/acme.com?page=2"), "https://rankedbyjev.com/s/acme.com?page=2");
    assert.strictEqual(to("https://www.rankedbyjev.com/faq"), "https://rankedbyjev.com/faq");
    assert.strictEqual(to("http://www.rankedbyjev.com/"), "https://rankedbyjev.com/");
    assert.strictEqual(to("https://jevboard.example.workers.dev/s/acme.com"), "https://rankedbyjev.com/s/acme.com");
    assert.strictEqual(canonicalRedirect(new Request("http://rankedbyjev.com/"), PUBLIC)?.status, 301);
  });

  it("leaves the public address, API routes, form posts and local development alone", () => {
    assert.isNull(to("https://rankedbyjev.com/"));
    assert.isNull(to("https://rankedbyjev.com/s/acme.com"));
    assert.isNull(to("http://rankedbyjev.com/api/autumn/webhook"));
    assert.isNull(to("http://rankedbyjev.com/judge", { method: "POST" }));
    assert.isNull(to("http://localhost:5173/", undefined, undefined));
    assert.isNull(to("http://127.0.0.1:8787/", undefined, PUBLIC));
  });
});
