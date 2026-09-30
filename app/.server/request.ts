import { Context } from "effect";

/**
 * The request a flow runs for (provided per request by ./http.ts). In its own
 * module so flows and their tests don't pull in the Worker runtime.
 */
export interface CurrentRequestShape {
  readonly request: Request;
  readonly url: URL;
  /** Public origin (PUBLIC_URL, or derived from the request / proxy headers). */
  readonly origin: string;
  /** Anonymous visitor id (`jev_vid` cookie). */
  readonly visitorId: string;
  /** True when the request carried no visitor cookie (first visit, or a bot). */
  readonly visitorIsNew: boolean;
  /** Client IP (CF-Connecting-IP; IPv6 reduced to its /64), for rate limiting only. */
  readonly clientIp: string;
}

export class CurrentRequest extends Context.Service<CurrentRequest, CurrentRequestShape>()("jevboard/CurrentRequest") {}

/**
 * IPv6 clients are bucketed by /64 (one customer usually owns a whole /64).
 * Compressed forms ("2001:db8::1:2:3:4") are expanded first, so a client
 * can't pick its own bucket; IPv4-mapped addresses count as the IPv4 address.
 */
export const clientIpOf = (request: Request): string => {
  const ip = (request.headers.get("cf-connecting-ip") ?? "unknown").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return mapped[1]!;
  const halves = ip.split("::");
  if (halves.length > 2) return ip;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return ip;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return ip;
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
};
