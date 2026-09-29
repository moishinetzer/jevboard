import { Context, Effect, Option } from "effect";
import type { RouterContextProvider } from "react-router";
import { AppConfig } from "./config";
import { toRouteOutcome } from "./route-errors";
import { type AppServices, runtime } from "./runtime";
import { Presence } from "./services/Presence";
import { visitorContext } from "./visitor";

/**
 * The React Router ↔ Effect bridge.
 *
 * Route modules stay thin:
 *
 *   export const loader = effectLoader("home", ({ request }) =>
 *     Effect.gen(function* () {
 *       const board = yield* Board;
 *       return { top: yield* board.top(10) };
 *     }),
 *   );
 *
 * The effect runs on the shared ManagedRuntime with every app service plus a
 * per-request `CurrentRequest` available. Returned values (including
 * `Response`s such as `redirect()`) pass straight through. Typed failures are
 * mapped to HTTP errors for the route's ErrorBoundary; defects are logged and
 * become a generic 500. Client disconnects interrupt the fiber.
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

export type RouteServices = AppServices | CurrentRequest;

interface RouteArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
}

/**
 * Public origin: PUBLIC_URL when configured, otherwise the request URL itself.
 * Forwarding headers are client-controlled on Workers, so they're ignored.
 */
const originFor = (request: Request, publicUrl: Option.Option<string>): string =>
  Option.isSome(publicUrl) ? publicUrl.value : new URL(request.url).origin;

/** IPv6 clients are bucketed by /64 (one customer usually owns a whole /64). */
const clientIpOf = (request: Request): string => {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!ip.includes(":")) return ip;
  const groups = ip.split(":");
  return `${groups.slice(0, 4).join(":")}::/64`;
};

const provideRequest = <A, E>(effect: Effect.Effect<A, E, RouteServices>, args: RouteArgs) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const visitor = args.context.get(visitorContext);
    const visitorId = visitor?.id ?? "anonymous";
    // Machine endpoints (webhooks, badges, images) don't count as visitors, and
    // neither does anyone whose cookie never comes back (bots, curl loops).
    const pathname = new URL(args.request.url).pathname;
    const human = !/^\/(api\/autumn|badge|og|healthz|sitemap)/.test(pathname);
    if (human && visitor && !visitor.isNew) yield* (yield* Presence).heartbeat(visitorId);
    return yield* effect.pipe(
      Effect.provideService(
        CurrentRequest,
        CurrentRequest.of({
          request: args.request,
          url: new URL(args.request.url),
          origin: originFor(args.request, config.publicUrl),
          visitorId,
          visitorIsNew: visitor?.isNew ?? true,
          clientIp: clientIpOf(args.request),
        }),
      ),
    );
  });

const run = async <A, E>(name: string, effect: Effect.Effect<A, E, RouteServices>, args: RouteArgs): Promise<A> => {
  const exit = await runtime.runPromiseExit(
    provideRequest(effect, args).pipe(
      Effect.withSpan(name, { attributes: { "http.method": args.request.method, "http.url": args.request.url } }),
    ),
    { signal: args.request.signal },
  );
  const outcome = toRouteOutcome(exit);
  if (outcome._tag === "Return") return outcome.value;
  if (outcome.defect) {
    await runtime.runPromise(Effect.logError(`Unhandled failure in ${name}`, outcome.defect)).catch(() => undefined);
  }
  throw outcome.thrown;
};

/** Wraps an Effect-returning function as a React Router `loader`. */
export const effectLoader =
  <Args extends RouteArgs, A, E>(name: string, body: (args: Args) => Effect.Effect<A, E, RouteServices>) =>
  (args: Args): Promise<A> =>
    run(`loader.${name}`, body(args), args);

/** Wraps an Effect-returning function as a React Router `action`. */
export const effectAction =
  <Args extends RouteArgs, A, E>(name: string, body: (args: Args) => Effect.Effect<A, E, RouteServices>) =>
  (args: Args): Promise<A> =>
    run(`action.${name}`, body(args), args);
