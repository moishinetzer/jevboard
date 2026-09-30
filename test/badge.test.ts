import { describe, expect, it } from "vitest";
import {
  BIG_BADGE_SIZE,
  buildBadge,
  buildNotJudgedBadge,
  escapeXml,
  parseBadgeStyle,
  parseBadgeTheme,
  textWidth,
  truncate,
} from "~/lib/badge";

const entry = {
  siteKey: "stripe.com",
  score: 812,
  rank: 14,
  total: 931,
};

/** Width/height attributes on the root <svg>. */
const size = (svg: string) => {
  const match = /^<svg[^>]*\swidth="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/.exec(svg);
  if (!match) throw new Error(`no size in ${svg.slice(0, 120)}`);
  return { width: Number(match[1]), height: Number(match[2]) };
};

/** Very small well-formedness check: every tag closes in order. */
const assertBalanced = (svg: string) => {
  const stack: Array<string> = [];
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
};

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
  });

  it("drops characters XML 1.0 cannot represent but keeps tabs, newlines and emoji", () => {
    expect(escapeXml("a\u0000b\u0008c\u000Bd\tf\ng￾")).toBe("abcd\tf\ng");
    expect(escapeXml("lone \uD800 surrogate")).toBe("lone  surrogate");
    expect(escapeXml("crown 👑")).toBe("crown 👑");
  });

  it("does not double-escape when called once", () => {
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });
});

describe("textWidth", () => {
  it("grows with length and is zero for empty text", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("jevboard")).toBeGreaterThan(textWidth("jev"));
  });

  it("measures wide glyphs wider than narrow ones", () => {
    expect(textWidth("WWWW")).toBeGreaterThan(textWidth("iiii") * 2);
    expect(textWidth("m")).toBeGreaterThan(textWidth("l"));
  });

  it("scales with font size and weight", () => {
    expect(textWidth("812/1000", 22)).toBeCloseTo(textWidth("812/1000", 11) * 2, 5);
    expect(textWidth("812/1000", 11, true)).toBeGreaterThan(textWidth("812/1000", 11));
  });

  it("is in the right ballpark for Verdana 11px", () => {
    // shields.io measures "build" as textLength 27px and "passing" as 43px.
    expect(textWidth("build")).toBeGreaterThan(25);
    expect(textWidth("build")).toBeLessThan(29);
    expect(textWidth("passing")).toBeGreaterThan(40);
    expect(textWidth("passing")).toBeLessThan(46);
  });

  it("treats CJK and emoji as full-width", () => {
    expect(textWidth("日本", 10)).toBe(20);
    expect(textWidth("👑", 10)).toBe(10);
  });
});

describe("truncate", () => {
  it("keeps short text and ellipsizes long text", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect([...truncate("👑👑👑👑👑", 3)]).toHaveLength(3);
  });
});

describe("option parsing", () => {
  it("falls back to defaults on unknown values", () => {
    expect(parseBadgeTheme("dark")).toBe("dark");
    expect(parseBadgeTheme("DARK")).toBe("dark");
    expect(parseBadgeTheme("neon")).toBe("light");
    expect(parseBadgeTheme(null)).toBe("light");
    expect(parseBadgeStyle("big")).toBe("big");
    expect(parseBadgeStyle("compact")).toBe("compact");
    expect(parseBadgeStyle("<script>")).toBe("default");
    expect(parseBadgeStyle(undefined)).toBe("default");
  });
});

describe("buildBadge", () => {
  it("renders the default shields-style badge", () => {
    const svg = buildBadge(entry);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(">jevboard</text>");
    expect(svg).toContain(">#14 · 812</text>");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>stripe.com is #14 of 931 on jevboard, with a score of 812</title>");
    // Accent value segment on the light theme.
    expect(svg).toContain('fill="#b45309"');
    assertBalanced(svg);
    expect(size(svg).height).toBe(20);
  });

  it("never mentions the old scale, tiers or caps wordmark", () => {
    for (const style of ["default", "compact", "big"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const svg = buildBadge({ ...entry, score: 1000, rank: 1 }, { style, theme }) + buildNotJudgedBadge("acme.com", { style, theme });
        expect(svg).not.toMatch(/\/\s?1000|JEV SCORE|JEVBOARD|Genuinely Useful|Civilizational|Why Does This Exist/);
      }
    }
  });

  it("sizes the pill to its text", () => {
    const short = size(buildBadge({ ...entry, score: 9, rank: 1 }));
    const long = size(buildBadge({ ...entry, score: 1000, rank: 12345 }));
    expect(long.width).toBeGreaterThan(short.width);
    // Label + value text plus padding always fit inside the badge.
    const minimum = textWidth("jevboard", 11, true) + textWidth("#12345 · 1000", 11, true);
    expect(long.width).toBeGreaterThan(minimum);
  });

  it("switches palettes by theme", () => {
    const light = buildBadge(entry, { theme: "light" });
    const dark = buildBadge(entry, { theme: "dark" });
    expect(light).not.toBe(dark);
    expect(dark).toContain('fill="#f5b93a"');
    expect(dark).toContain('stroke="#34312a"');
    expect(light).toContain('stroke="#ebe5d4"');
  });

  it("has a compact variant that is narrower than the default", () => {
    const compact = buildBadge(entry, { style: "compact" });
    expect(compact).toContain(">#14 · 812</text>");
    expect(compact).not.toContain(">jevboard</text>");
    expect(size(compact).width).toBeLessThan(size(buildBadge(entry)).width);
    assertBalanced(compact);
  });

  it("has a big card variant with rank, score and site", () => {
    const big = buildBadge(entry, { style: "big", theme: "dark" });
    expect(size(big)).toEqual(BIG_BADGE_SIZE);
    expect(big).toContain(">812</text>");
    expect(big).toContain(">#14 on the board</text>");
    expect(big).toContain(">stripe.com</text>");
    expect(big).toContain(">jevboard</text>");
    // No crown outside the top three.
    expect(big).not.toContain("M2 16 L4 4");
    assertBalanced(big);
  });

  it("crowns and medal-tints the top three on the big card", () => {
    const tints = { 1: "#fff7d1", 2: "#f4f5f7", 3: "#fcf0e4" } as const;
    for (const rank of [1, 2, 3] as const) {
      const big = buildBadge({ ...entry, rank }, { style: "big" });
      expect(big).toContain("M2 16 L4 4");
      expect(big).toContain(`fill="${tints[rank]}"`);
      assertBalanced(big);
    }
  });

  it("keeps long site keys inside the big card", () => {
    const big = buildBadge({ ...entry, siteKey: "chromewebstore.google.com/detail/some-extension", score: 1000 }, { style: "big" });
    const site = />([^<]*…)<\/text>/.exec(big)?.[1];
    expect(site).toBeDefined();
    expect(textWidth(site!, 12, true) + textWidth("1000", 44, true)).toBeLessThan(BIG_BADGE_SIZE.width - 28);
  });

  it("escapes hostile text everywhere it is interpolated", () => {
    const hostile = `"><script>alert(1)</script>&`;
    const svg = buildBadge({ ...entry, siteKey: hostile }, { style: "big", href: `https://j.test/s/${hostile}` });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain('href="https://j.test/s/&quot;&gt;&lt;script&gt;');
    assertBalanced(svg);
  });

  it("wraps the badge in a link when an href is given", () => {
    const svg = buildBadge(entry, { href: "https://jevboard.com/s/stripe.com" });
    expect(svg).toContain('<a href="https://jevboard.com/s/stripe.com" target="_blank">');
    assertBalanced(svg);
  });
});

describe("buildNotJudgedBadge", () => {
  it("renders a muted placeholder in every style", () => {
    for (const style of ["default", "compact", "big"] as const) {
      const svg = buildNotJudgedBadge("acme.com", { style });
      expect(svg).toContain('fill="#6b6658"');
      expect(svg).not.toContain('fill="#b45309"');
      expect(svg).toContain("acme.com is not on jevboard yet");
      assertBalanced(svg);
    }
    expect(buildNotJudgedBadge("acme.com")).toContain(">not ranked yet</text>");
    expect(buildNotJudgedBadge("acme.com", { style: "compact" })).toContain(">not ranked</text>");
  });
});
