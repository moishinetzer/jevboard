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
