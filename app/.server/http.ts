import { Effect, Option } from "effect";
import type { RouterContextProvider } from "react-router";
import { AppConfig } from "./config";
import { toRouteOutcome } from "./route-errors";
import { type AppServices, runtime } from "./runtime";
import { AnalyticsActor } from "./services/Analytics";
import { reportServerError } from "./report";
import { CurrentRequest } from "./request";
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

export { CurrentRequest, type CurrentRequestShape } from "./request";

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

/** The browser SDK sends its session id on same-site requests (`tracing_headers`). */
const sessionIdOf = (request: Request): string | null => {
  const id = request.headers.get("x-posthog-session-id")?.trim();
  return id && /^[\w-]{1,100}$/.test(id) ? id : null;
};

const run = async <A, E>(name: string, effect: Effect.Effect<A, E, RouteServices>, args: RouteArgs): Promise<A> => {
  const visitorId = args.context.get(visitorContext)?.id ?? null;
  const sessionId = sessionIdOf(args.request);
  const exit = await runtime.runPromiseExit(
    provideRequest(effect, args).pipe(
      Effect.provideService(AnalyticsActor, { distinctId: visitorId, sessionId }),
      // posthogDistinctId / sessionId link the trace to the person and their session replay.
      Effect.withSpan(name, {
        attributes: {
          "http.method": args.request.method,
          "http.url": args.request.url,
          ...(visitorId ? { posthogDistinctId: visitorId } : {}),
          ...(sessionId ? { sessionId } : {}),
        },
      }),
    ),
    { signal: args.request.signal },
  );
  const outcome = toRouteOutcome(exit);
  if (outcome._tag === "Return") return outcome.value;
  if (outcome.defect) {
    reportServerError(outcome.defect, { route: name, method: args.request.method });
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
