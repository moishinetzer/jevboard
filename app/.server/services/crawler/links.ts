import type { ExtractedLink } from "./html";

/**
 * Picks the few same-site pages worth showing Jev besides the homepage:
 * the ones that explain what the business is and costs (pricing, about,
 * product, ...), never auth/cart/legal pages, blog posts or files.
 */

interface KeywordGroup {
  readonly group: string;
  readonly weight: number;
  readonly words: ReadonlyArray<string>;
}

const KEYWORD_GROUPS: ReadonlyArray<KeywordGroup> = [
  { group: "pricing", weight: 10, words: ["pricing", "prices", "price", "plans", "tarifs", "preise", "precios"] },
  {
    group: "about",
    weight: 9,
    words: ["about", "about-us", "who-we-are", "our-story", "company", "mission", "ueber-uns", "uber-uns", "a-propos", "quienes-somos"],
  },
  {
    group: "product",
    weight: 8,
    words: ["product", "products", "features", "how-it-works", "platform", "solutions", "services", "what-we-do", "tour"],
  },
  { group: "menu", weight: 7, words: ["menu", "menus", "shop", "store", "catalog", "catalogue", "collections"] },
  { group: "customers", weight: 5, words: ["customers", "case-studies", "use-cases", "testimonials", "clients", "portfolio", "showcase"] },
  { group: "faq", weight: 4, words: ["faq", "faqs", "docs", "documentation"] },
  { group: "team", weight: 4, words: ["team", "founders", "people"] },
];

/** Pages that tell Jev nothing about the business (or that we shouldn't poke). */
const EXCLUDED_WORDS = new Set([
  "login", "log-in", "signin", "sign-in", "logout", "signup", "sign-up", "register", "auth", "oauth", "sso",
  "account", "my-account", "dashboard", "admin", "wp-admin", "wp-login.php",
  "cart", "basket", "checkout",
  "legal", "privacy", "terms", "tos", "cookie", "cookies", "gdpr", "imprint", "impressum", "dmca",
  "careers", "jobs",
  "search", "tag", "tags", "category", "author", "feed", "rss",
]);

/** Sections whose sub-pages are individual posts, not descriptions of the business. */
const POST_SECTIONS = new Set([
  "blog", "news", "posts", "post", "articles", "article", "stories", "press", "changelog", "updates",
  "insights", "events", "podcast", "episodes", "webinars", "p",
]);

const ASSET_EXTENSION =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tgz|tar|rar|7z|dmg|exe|msi|apk|pkg|deb|rpm|iso|mp[34]|m4a|mov|avi|webm|wav|ogg|woff2?|ttf|otf|eot|css|m?js|json|xml|rss|atom|txt|csv|docx?|xlsx?|pptx?|epub)$/i;

const MAX_DEPTH = 3;

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, "");

const segmentsOf = (pathname: string): Array<string> =>
  pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });

/** Identity of a page for dedupe: host without www, path without trailing slash, query kept. */
export const pageKey = (url: string): string => {
  const parsed = new URL(url);
  return `${stripWww(parsed.hostname)}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
};

/** Anchor-text matchers: "how-it-works" also matches "How it works". */
const TEXT_PATTERNS = new Map(
  KEYWORD_GROUPS.flatMap((group) => group.words).map((word): [string, RegExp] => [word, new RegExp(`\\b${word.replace(/-/g, "[\\s-]")}\\b`)]),
);

const bestGroup = (matches: (word: string) => boolean): KeywordGroup | undefined =>
  KEYWORD_GROUPS.find((group) => group.words.some(matches));

export interface ScoredLink {
  readonly url: string;
  readonly score: number;
  readonly group: string;
}

/**
 * Scores one link relative to the section being crawled (`scopeSegments` is
 * empty for a normal site, `["acme"]` for `github.com/acme`). Returns
 * `undefined` for links that must never be fetched or carry no keyword.
 */
export const scoreLink = (link: ExtractedLink, scopeSegments: ReadonlyArray<string> = []): ScoredLink | undefined => {
  const segments = segmentsOf(new URL(link.url).pathname).slice(scopeSegments.length);
  if (segments.length === 0 || segments.length > MAX_DEPTH) return undefined;
  if (ASSET_EXTENSION.test(segments[segments.length - 1]!)) return undefined;
  if (segments.some((segment) => /^(19|20)\d\d$/.test(segment))) return undefined; // dated posts: /2024/05/...
  if (POST_SECTIONS.has(segments[0]!) && segments.length > 1) return undefined;

  const words = segments.flatMap((segment) => {
    const bare = segment.replace(/\.(html?|php|aspx?)$/, "");
    return [bare, ...bare.split(/[-_.]+/)];
  });
  if (words.some((word) => EXCLUDED_WORDS.has(word))) return undefined;

  const anchor = link.text.toLowerCase();
  const fromPath = bestGroup((word) => words.includes(word));
  const fromText = bestGroup((word) => TEXT_PATTERNS.get(word)!.test(anchor));
  const best = [fromPath, fromText].reduce<KeywordGroup | undefined>(
    (acc, group) => (group && (!acc || group.weight > acc.weight) ? group : acc),
    undefined,
  );
  if (!best) return undefined;

  // Path and anchor agreeing is a strong signal; nested pages are usually narrower.
  const agreement = fromPath && fromText ? 2 : 0;
  const score = best.weight + agreement - (segments.length - 1) * 3;
  return score > 0 ? { url: link.url, score, group: best.group } : undefined;
};

export interface SelectLinksOptions {
  /** Final URL of the homepage (links are resolved against and compared to it). */
  readonly pageUrl: string;
  /**
   * The URL the crawl was asked for. When it has a path (`github.com/acme`),
   * only links inside that path are followed.
   */
  readonly scopeUrl: string;
  readonly max: number;
}

/**
 * Chooses up to `max` extra pages: same host (www-insensitive), inside the
 * scope, scored by keywords. Prefers one page per keyword group (pricing,
 * about, product, ...) before taking a second page from the same group.
 */
export const selectLinks = (links: ReadonlyArray<ExtractedLink>, options: SelectLinksOptions): Array<string> => {
  if (options.max <= 0) return [];
  const home = new URL(options.pageUrl);
  const homeKey = pageKey(options.pageUrl);
  const scopeSegments = segmentsOf(new URL(options.scopeUrl).pathname);

  const candidates = new Map<string, ScoredLink & { readonly order: number }>();
  links.forEach((link, order) => {
    const url = new URL(link.url);
    if (stripWww(url.hostname) !== stripWww(home.hostname)) return;
    const segments = segmentsOf(url.pathname);
    if (scopeSegments.some((segment, i) => segments[i] !== segment)) return;
    const key = pageKey(link.url);
    if (key === homeKey) return;
    const scored = scoreLink(link, scopeSegments);
    if (!scored) return;
    const existing = candidates.get(key);
    if (!existing || scored.score > existing.score) candidates.set(key, { ...scored, order: existing?.order ?? order });
  });

  // Ties keep document order: navigation order reflects what the site itself leads with.
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: Array<string> = [];
  const groups = new Set<string>();
  for (const candidate of ranked) {
    if (picked.length < options.max && !groups.has(candidate.group)) {
      picked.push(candidate.url);
      groups.add(candidate.group);
    }
  }
  for (const candidate of ranked) {
    if (picked.length < options.max && !picked.includes(candidate.url)) picked.push(candidate.url);
  }
  return picked;
};
