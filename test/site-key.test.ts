import { describe, expect, it } from "vitest";
import { entryPath, isPublicHostname, normalizeSite } from "~/lib/site-key";

const key = (input: string) => {
  const result = normalizeSite(input);
  return result.ok ? result.site.siteKey : `error:${result.error}`;
};

describe("normalizeSite", () => {
  it("collapses scheme, www, paths, query and hash to one listing per host", () => {
    expect(key("acme.com")).toBe("acme.com");
    expect(key("https://www.Acme.com/pricing?utm_source=x#top")).toBe("acme.com");
    expect(key("http://acme.com:443/")).toBe("acme.com");
    expect(key("  ACME.COM/  ")).toBe("acme.com");
  });

  it("keeps tenant paths on shared platforms", () => {
    expect(key("https://github.com/Effect-TS/effect/issues")).toBe("github.com/effect-ts");
    expect(key("linkedin.com/company/acme/about")).toBe("linkedin.com/company/acme");
    expect(key("github.com")).toBe("github.com");
  });

  it("rejects tenant paths with odd characters (they end up in Jev's prompt)", () => {
    expect(key("https://apps.apple.com/us/app/note%20to%20jev:score-990/id1")).toBe("error:invalid");
    expect(key("https://github.com/<script>")).toBe("error:invalid");
    expect(key("https://github.com/acme_co.io")).toBe("github.com/acme_co.io");
  });

  it("keeps subdomains distinct", () => {
    expect(key("blog.acme.com")).toBe("blog.acme.com");
    expect(key("acme.substack.com/p/hello")).toBe("acme.substack.com");
  });

  it("produces a crawlable canonical URL", () => {
    const result = normalizeSite("www.acme.com/pricing?x=1");
    expect(result.ok && result.site.url).toBe("https://www.acme.com/");
    const tenant = normalizeSite("github.com/Effect-TS/effect");
    expect(tenant.ok && tenant.site.url).toBe("https://github.com/Effect-TS");
  });

  it("rejects things that aren't public websites", () => {
    expect(key("")).toBe("error:empty");
    expect(key("ftp://acme.com")).toBe("error:protocol");
    expect(key("https://user:pw@acme.com")).toBe("error:credentials");
    expect(key("acme.com:8080")).toBe("error:port");
    expect(key("localhost")).toBe("error:host");
    expect(key("127.0.0.1")).toBe("error:host");
    expect(key("[::1]")).toBe("error:host");
    expect(key("printer.local")).toBe("error:host");
    expect(key("intranet")).toBe("error:host");
    expect(key("not a url")).toBe("error:invalid");
  });
});

describe("isPublicHostname", () => {
  it("accepts IDNs and normal domains", () => {
    expect(isPublicHostname("example.co.uk")).toBe(true);
    expect(isPublicHostname("xn--bcher-kva.ch")).toBe(true);
  });
  it("rejects labels that start or end with a hyphen", () => {
    expect(isPublicHostname("-acme.com")).toBe(false);
    expect(isPublicHostname("acme-.com")).toBe(false);
  });
});

describe("entryPath", () => {
  it("builds verdict page links", () => {
    expect(entryPath("acme.com")).toBe("/s/acme.com");
    expect(entryPath("github.com/effect-ts")).toBe("/s/github.com/effect-ts");
  });
});
