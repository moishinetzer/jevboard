import { Clock, Duration, Effect, Schema } from "effect";
import { isPublicHostname } from "~/lib/site-key";
import { CrawlError } from "../../domain/errors";

/**
 * SSRF guard for the crawler. Web-standard APIs only (runs on Cloudflare
 * Workers and Node alike). Two checks run before every request, i.e. for the
 * submitted URL and again for every redirect target:
 *
 * 1. `hopViolation`: http(s) only, ports 80/443 only, no credentials, and the
 *    host must be a public DNS name (never an IP literal or `localhost`).
 * 2. `resolveHost` + `isBlockedAddress`: the host's A/AAAA records are
 *    resolved (DNS-over-HTTPS by default) and the hop is refused if ANY of
 *    them is private/reserved, so a multi-record answer can't smuggle an
 *    internal address past us.
 *
 * `fetch` can't pin the address it connects to, so a DNS-rebinding race
 * between our lookup and the platform's is theoretically possible. On Workers
 * the platform itself refuses connections to private/reserved addresses; the
 * check here is what produces a clean "blocked" error and protects Node dev.
 */

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

/** Strict dotted-quad → uint32 (as a JS number), or `undefined`. */
const parseIPv4 = (text: string): number | undefined => {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
};

/** IPv6 text (compressed `::`, embedded IPv4 tail) → eight 16-bit groups, or `undefined`. */
const parseIPv6 = (text: string): ReadonlyArray<number> | undefined => {
  let source = text;
  if (source.includes(".")) {
    // `::ffff:1.2.3.4` → `::ffff:102:304`
    const lastColon = source.lastIndexOf(":");
    const v4 = parseIPv4(source.slice(lastColon + 1));
    if (v4 === undefined) return undefined;
    source = `${source.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const split = (half: string) => (half === "" ? [] : half.split(":"));
  const head = split(halves[0]!);
  const tail = halves.length === 2 ? split(halves[1]!) : [];
  if (halves.length === 2 && head.length + tail.length > 7) return undefined;
  const groups = halves.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return groups.map((group) => parseInt(group, 16));
};

const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255 broadcast
];

const IPV6_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["::", 96], // unspecified (::), loopback (::1) and deprecated IPv4-compatible (::a.b.c.d)
  ["64:ff9b::", 96], // NAT64: would reach arbitrary IPv4 through a translator
  ["64:ff9b:1::", 48], // local-use NAT64 (RFC 8215)
  ["::ffff:0:0:0", 96], // SIIT IPv4-translated addresses
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo (embeds an IPv4 server/client)
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

const V4_RANGES = IPV4_BLOCKED.map(([network, bits]) => ({ network: parseIPv4(network)!, bits }));
const V6_RANGES = IPV6_BLOCKED.map(([network, bits]) => ({ network: parseIPv6(network)!, bits }));

const isBlockedV4 = (ip: number): boolean =>
  V4_RANGES.some(({ network, bits }) => Math.floor(ip / 2 ** (32 - bits)) === Math.floor(network / 2 ** (32 - bits)));

const inV6Prefix = (ip: ReadonlyArray<number>, network: ReadonlyArray<number>, bits: number): boolean => {
  for (let i = 0; i < 8; i++) {
    const take = Math.min(16, Math.max(0, bits - 16 * i));
    if (take === 0) return true;
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((ip[i]! & mask) !== (network[i]! & mask)) return false;
  }
  return true;
};

/**
 * True when the crawler must not talk to `address`. IPv4-mapped IPv6
 * (`::ffff:a.b.c.d`, any spelling) is judged by its IPv4 part. Anything that
 * is not a valid IP is blocked.
 */
export const isBlockedAddress = (address: string): boolean => {
  const bare = address.replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  const v4 = parseIPv4(bare);
  if (v4 !== undefined) return isBlockedV4(v4);
  const v6 = parseIPv6(bare);
  if (v6 === undefined) return true;
  const mapped = v6.slice(0, 5).every((group) => group === 0) && v6[5] === 0xffff;
  if (mapped) return isBlockedV4(v6[6]! * 65536 + v6[7]!);
  return V6_RANGES.some(({ network, bits }) => inV6Prefix(v6, network, bits));
};

// ---------------------------------------------------------------------------
// URL rules
// ---------------------------------------------------------------------------

/** Why a URL may not be requested, or `undefined` when it may. */
export const hopViolation = (url: URL, allowPrivateNetwork: boolean): string | undefined => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return `unsupported protocol ${url.protocol}`;
  if (url.username || url.password) return "URLs with credentials are not allowed";
  if (allowPrivateNetwork) return undefined;
  if (url.port && url.port !== "80" && url.port !== "443") return `port ${url.port} is not allowed`;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isPublicHostname(host)) return `${host} is not a public hostname`;
  return undefined;
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a hostname to all of its IPv4/IPv6 addresses. Fails with
 * `CrawlError` "dns" when the name doesn't resolve (its `url` is the
 * hostname; callers re-attach the crawled URL).
 */
export type Resolver = (hostname: string) => Effect.Effect<ReadonlyArray<string>, CrawlError>;

const DohResponse = Schema.Struct({
  Status: Schema.Number,
  Answer: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.Number, data: Schema.String }))),
});

const DNS_TYPES = { A: 1, AAAA: 28 } as const;
const DNS_NXDOMAIN = 3;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1_000;

export interface DohResolverOptions {
  /** JSON DoH endpoint. Default Cloudflare's. */
  readonly endpoint?: string;
  /** Budget for resolving one name (A and AAAA in parallel). Default 4 s. */
  readonly timeout?: Duration.Input;
}

/**
 * DNS-over-HTTPS resolver (Cloudflare JSON API) with a small in-memory cache
 * (60 s, successes only) per resolver instance.
 */
export const makeDohResolver = (options: DohResolverOptions = {}): Resolver => {
  const endpoint = options.endpoint ?? "https://cloudflare-dns.com/dns-query";
  const timeout = options.timeout ?? "4 seconds";
  const cache = new Map<string, { readonly expiresAt: number; readonly addresses: ReadonlyArray<string> }>();

  const query = (hostname: string, type: keyof typeof DNS_TYPES) =>
    Effect.tryPromise({
      try: async (signal) => {
        const url = `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`;
        const response = await fetch(url, { headers: { accept: "application/dns-json" }, signal });
        if (!response.ok) throw new Error(`DoH HTTP ${response.status}`);
        return (await response.json()) as unknown;
      },
      catch: () => new CrawlError({ url: hostname, reason: "unreachable", message: "DNS lookup failed" }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DohResponse)),
      Effect.mapError((error) =>
        error._tag === "CrawlError"
          ? error
          : new CrawlError({ url: hostname, reason: "unreachable", message: "DNS lookup returned an invalid answer" }),
      ),
    );

  return Effect.fnUntraced(
    function* (hostname: string) {
      const key = hostname.toLowerCase();
      const now = yield* Clock.currentTimeMillis;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) return cached.addresses;

      const [a, aaaa] = yield* Effect.all([query(key, "A"), query(key, "AAAA")], { concurrency: 2 });
      if (a.Status === DNS_NXDOMAIN || aaaa.Status === DNS_NXDOMAIN) {
        return yield* new CrawlError({ url: hostname, reason: "dns", message: `${hostname} does not exist` });
      }
      if (a.Status !== 0 || aaaa.Status !== 0) {
        return yield* new CrawlError({
          url: hostname,
          reason: "dns",
          message: `DNS lookup for ${hostname} failed (rcode ${a.Status !== 0 ? a.Status : aaaa.Status})`,
        });
      }
      // Answers also carry the CNAME chain; keep only address records.
      const addresses = [
        ...(a.Answer ?? []).filter((record) => record.type === DNS_TYPES.A),
        ...(aaaa.Answer ?? []).filter((record) => record.type === DNS_TYPES.AAAA),
      ].map((record) => record.data);
      if (addresses.length === 0) {
        return yield* new CrawlError({ url: hostname, reason: "dns", message: `${hostname} has no address records` });
      }

      if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
      cache.set(key, { expiresAt: now + CACHE_TTL_MS, addresses });
      return addresses;
    },
    (effect, hostname) =>
      Effect.timeoutOrElse(effect, {
        duration: timeout,
        orElse: () => Effect.fail(new CrawlError({ url: hostname, reason: "timeout", message: "DNS lookup timed out" })),
      }),
  );
};

/**
 * Resolves `hostname` and fails with "blocked" if any address is
 * private/reserved. Errors carry `url` (the URL being crawled).
 */
export const guardHost = (resolve: Resolver, hostname: string, url: string): Effect.Effect<void, CrawlError> =>
  resolve(hostname).pipe(
    Effect.mapError((error) => new CrawlError({ url, reason: error.reason, message: error.message })),
    Effect.flatMap((addresses) =>
      addresses.some(isBlockedAddress)
        ? Effect.fail(
            new CrawlError({ url, reason: "blocked", message: `${hostname} resolves to a private or reserved address` }),
          )
        : Effect.void,
    ),
  );
