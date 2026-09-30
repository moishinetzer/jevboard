import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDED_FONTS } from "~/.server/og/fonts.generated";
import { ogFonts } from "~/.server/og/fonts";
import { LruCache } from "~/.server/og/lru";
import { siteKeyFromAssetPath } from "~/.server/og/path";
import {
  cachedCard,
  clearCardCache,
  defaultCardKey,
  defaultCardPng,
  entryCardKey,
  entryCardPng,
  OG_CACHE_CONTROL,
  type EntryCardProps,
  pngResponse,
} from "~/.server/og/render";

/** Set OG_PREVIEW_DIR=/some/dir to write the rendered cards to disk for eyeballing. */
const preview = (name: string, bytes: Uint8Array) => {
  const dir = process.env.OG_PREVIEW_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
};

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const entry: EntryCardProps = {
  siteKey: "stripe.com",
  score: 812,
  rank: 14,
  total: 931,
  tldr: "Online payments infrastructure for businesses of every size, from startups to large enterprises, with APIs for checkout, billing and payouts.",
  serial: 42,
  roll: 1,
  host: "jevboard.com",
};

afterEach(() => {
  clearCardCache();
  vi.unstubAllGlobals();
});

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const lru = new LruCache<string, number>(2);
    lru.set("a", 1).set("b", 2);
    expect(lru.get("a")).toBe(1); // "b" is now the oldest
    lru.set("c", 3);
    expect(lru.has("b")).toBe(false);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
    expect(lru.size).toBe(2);
  });

  it("re-setting a key refreshes it instead of duplicating", () => {
    const lru = new LruCache<string, number>(2);
    lru.set("a", 1).set("b", 2).set("a", 10).set("c", 3);
    expect(lru.get("a")).toBe(10);
    expect(lru.has("b")).toBe(false);
  });

  it("rejects nonsense capacities", () => {
    expect(() => new LruCache(0)).toThrow(RangeError);
  });
});

describe("siteKeyFromAssetPath", () => {
  it("strips the extension, lowercases and decodes", () => {
    expect(siteKeyFromAssetPath("Stripe.com.png", "png")).toBe("stripe.com");
    expect(siteKeyFromAssetPath("github.com/Effect-TS.png", "png")).toBe("github.com/effect-ts");
    expect(siteKeyFromAssetPath("caf%C3%A9.fr.svg", "svg")).toBe("café.fr");
    expect(siteKeyFromAssetPath("acme.com.svg/", "svg")).toBe("acme.com");
  });

  it("only strips its own extension and survives bad escapes", () => {
    expect(siteKeyFromAssetPath("acme.png", "svg")).toBe("acme.png");
    expect(siteKeyFromAssetPath("%E0%A4%A.png", "png")).toBe("%e0%a4%a");
    expect(siteKeyFromAssetPath(undefined, "png")).toBe("");
  });
});

describe("fonts", () => {
  it("embeds a small set of woff fonts and decodes them once", () => {
    const totalBase64 = EMBEDDED_FONTS.reduce((sum, font) => sum + font.base64.length, 0);
    expect(totalBase64).toBeLessThan(160_000);
    const fonts = ogFonts();
    expect(fonts.map((font) => `${font.name}:${font.weight}`)).toEqual([
      "Anton:400",
      "Space Grotesk:500",
      "Space Grotesk:700",
      "JetBrains Mono:700",
    ]);
    for (const font of fonts) {
      const bytes = new Uint8Array(font.data as ArrayBuffer);
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("wOFF");
    }
    expect(ogFonts()[0]!.data).toBe(fonts[0]!.data);
  });
});

describe("card cache keys", () => {
  it("change whenever the pixels would", () => {
    const base = entryCardKey("j1", entry);
    expect(entryCardKey("j1", entry)).toBe(base);
    expect(entryCardKey("j2", entry)).not.toBe(base);
    expect(entryCardKey("j1", { ...entry, rank: 13 })).not.toBe(base);
    expect(entryCardKey("j1", { ...entry, total: 932 })).not.toBe(base);
    const site = { entries: 1, judgments: 2, revenueCents: 1000, king: { siteKey: "a.com", score: 900 }, host: "jevboard.com" };
    expect(defaultCardKey(site)).not.toBe(defaultCardKey({ ...site, king: null }));
  });
});

describe("cachedCard", () => {
  it("renders once for concurrent and repeated requests", async () => {
    const make = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const [a, b] = await Promise.all([cachedCard("k", "https://j.test", make), cachedCard("k", "https://j.test", make)]);
    await cachedCard("k", "https://j.test", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("forgets failed renders so the next request retries", async () => {
    const make = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(new Uint8Array([7]));
    await expect(cachedCard("k2", "https://j.test", make)).rejects.toThrow("boom");
    await expect(cachedCard("k2", "https://j.test", make)).resolves.toEqual(new Uint8Array([7]));
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("uses the Workers Cache API when caches.default exists", async () => {
    const store = new Map<string, Response>();
    const edge = {
      match: vi.fn(async (url: string) => store.get(url)?.clone()),
      put: vi.fn(async (url: string, response: Response) => void store.set(url, response)),
    };
    vi.stubGlobal("caches", { default: edge });
    const make = vi.fn(async () => new Uint8Array([9, 9]));

    await cachedCard("edge|key", "https://jevboard.com", make);
    expect(edge.put).toHaveBeenCalledTimes(1);
    expect(edge.put.mock.calls[0]![0]).toBe("https://jevboard.com/__og-cache/edge%7Ckey.png");

    clearCardCache(); // new isolate: memory is empty, the edge still has it
    const bytes = await cachedCard("edge|key", "https://jevboard.com", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect([...bytes]).toEqual([9, 9]);
  });
});

describe("rendering", () => {
  it("renders the verdict card as a 1200×630 PNG", async () => {
    const png = await entryCardPng("j1", entry, "https://jevboard.com");
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    expect(await entryCardPng("j1", entry, "https://jevboard.com")).toBe(png);
    preview("entry.png", png);
  }, 30_000);

  it("survives worst-case copy (long key, long TL;DR, 1000, retrial, emoji)", async () => {
    const png = await entryCardPng(
      "j2",
      {
        ...entry,
        siteKey: "chromewebstore.google.com/detail/website-roast-ai-ux-landi/gfkbhifofimcdcbapfbkgajomlaflkfo",
        score: 1000,
        rank: 1,
        total: 123456,
        tldr: "An AI assistant 👀 with a waitlist, a Discord, a token and a podcast, for people who want all four. ".repeat(6),
        serial: 123456,
        roll: 17,
      },
      "https://jevboard.com",
    );
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    preview("entry-worst.png", png);
  }, 30_000);

  it("renders the default site card with and without a king", async () => {
    const withKing = await defaultCardPng(
      { entries: 931, judgments: 1204, revenueCents: 602_000, king: { siteKey: "archive.org", score: 925 }, host: "jevboard.com" },
      "https://jevboard.com",
    );
    const empty = await defaultCardPng({ entries: 0, judgments: 0, revenueCents: 0, king: null, host: "jevboard.com" }, "https://jevboard.com");
    expect(pngSize(withKing)).toEqual({ width: 1200, height: 630 });
    expect(pngSize(empty)).toEqual({ width: 1200, height: 630 });
    preview("default.png", withKing);
    preview("default-empty.png", empty);
  }, 30_000);

  it("serves PNGs with CDN-friendly headers", async () => {
    const response = pngResponse(new Uint8Array([1, 2, 3]));
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe(OG_CACHE_CONTROL);
    expect(OG_CACHE_CONTROL).toContain("s-maxage=3600");
    expect(OG_CACHE_CONTROL).toContain("stale-while-revalidate");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
