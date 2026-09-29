/**
 * URL normalisation shared by the server and the browser.
 *
 * Every business on the board is identified by a "site key": the lowercase
 * hostname without a leading `www.`. One listing per host, so `acme.com/pricing`
 * and `acme.com` are the same defendant and Jev judges from the homepage.
 *
 * Shared platforms where the business lives *below* the root (GitHub orgs,
 * X handles, Product Hunt pages, ...) keep their first path segments instead,
 * e.g. `github.com/acme`.
 */

export interface NormalizedSite {
  /** Stable identity used in URLs: `acme.com` or `github.com/acme`. */
  readonly siteKey: string;
  /** Canonical URL Jev will crawl. */
  readonly url: string;
  /** Hostname, lowercase, `www.` stripped. */
  readonly host: string;
}

export type NormalizeError =
  | "empty"
  | "invalid"
  | "protocol"
  | "credentials"
  | "port"
  | "host"
  | "too-long";

export const normalizeErrorMessage: Record<NormalizeError, string> = {
  empty: "Paste a URL first. Jev can't judge the void.",
  invalid: "That doesn't look like a website URL.",
  protocol: "Only http(s) websites, please.",
  credentials: "URLs with usernames or passwords are not allowed.",
  port: "Jev only visits websites on the standard ports.",
  host: "Jev needs a real public domain name (no IPs, no localhost).",
  "too-long": "That URL is way too long.",
};

const MAX_URL_LENGTH = 2048;

/** Hosts whose tenants live in the path, and how many path segments identify one. */
const PATH_TENANT_HOSTS: Record<string, number> = {
  "github.com": 1,
  "gitlab.com": 1,
  "codeberg.org": 1,
  "x.com": 1,
  "twitter.com": 1,
  "instagram.com": 1,
  "tiktok.com": 1,
  "threads.net": 1,
  "facebook.com": 1,
  "youtube.com": 1,
  "medium.com": 1,
  "linktr.ee": 1,
  "bsky.app": 2,
  "linkedin.com": 2,
  "producthunt.com": 2,
  "etsy.com": 2,
  "huggingface.co": 2,
  "sites.google.com": 2,
  "apps.apple.com": 4,
  "chromewebstore.google.com": 3,
  "npmjs.com": 2,
  "pypi.org": 2,
  "crates.io": 2,
};
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

export const normalizeSite = (
  input: string,
): { ok: true; site: NormalizedSite } | { ok: false; error: NormalizeError } => {
  let raw = input.trim();
  if (raw.length === 0) return { ok: false, error: "empty" };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: "too-long" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "invalid" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "protocol" };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "credentials" };
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { ok: false, error: "port" };
  }

  let host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!isPublicHostname(host)) return { ok: false, error: "host" };

  const tenantSegments = PATH_TENANT_HOSTS[host] ?? 0;
  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .slice(0, tenantSegments);
  const path = segments.length > 0 ? `/${segments.join("/")}` : "";
  const cleanPath = safeDecodePath(path).toLowerCase();
  const siteKey = cleanPath.length > 0 ? `${host}${cleanPath}` : host;
  const url = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path || "/"}`;

  return { ok: true, site: { siteKey, url, host } };
};

/** True for syntactically valid, public-looking DNS names (not IP literals). */
export const isPublicHostname = (host: string): boolean => {
  if (host.length === 0 || host.length > 253) return false;
  if (host === "localhost") return false;
  // IPv4 / IPv6 literals are never accepted as businesses.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1]!;
  if (!/^(xn--[a-z0-9-]{2,59}|[a-z]{2,63})$/.test(tld)) return false;
  return labels.every((label) => HOST_LABEL.test(label));
};

const safeDecodePath = (path: string): string => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

/** Pretty label for UI: `acme.com` or `github.com/acme`. */
export const displaySite = (siteKey: string): string => siteKey;

/** Link to an entry's page. */
export const entryPath = (siteKey: string): string =>
  `/s/${siteKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
