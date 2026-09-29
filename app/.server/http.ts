import { Cause, Context, Effect, Exit, Option } from "effect";
import { data, type RouterContextProvider } from "react-router";
import { AppConfig } from "./config";
import { type AppServices, runtime } from "./runtime";
import { Board } from "./services/Board";
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
  /** Anonymous visitor id (`jev_vid` cookie); also the Autumn customer id. */
  readonly visitorId: string;
}

export class CurrentRequest extends Context.Service<CurrentRequest, CurrentRequestShape>()("jevboard/CurrentRequest") {}

export type RouteServices = AppServices | CurrentRequest;

interface RouteArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
}

/** Error tag → HTTP status. Anything else is a 500. */
const STATUS_BY_TAG: Record<string, number> = {
  InvalidSite: 400,
  SchemaError: 400,
  NotFound: 404,
  CrawlError: 422,
  PaymentError: 502,
  JudgeError: 502,
};

export interface RouteErrorData {
  readonly error: string;
  readonly message: string;
}

const originFor = (request: Request, publicUrl: Option.Option<string>): string => {
  if (Option.isSome(publicUrl)) return publicUrl.value;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  return `${proto}://${host}`;
};

const provideRequest = <A, E>(effect: Effect.Effect<A, E, RouteServices>, args: RouteArgs) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const visitor = args.context.get(visitorContext);
    const visitorId = visitor?.id ?? "anonymous";
    if (visitor?.isNew) yield* (yield* Board).recordVisitor(visitor.id);
    yield* (yield* Presence).heartbeat(visitorId);
    return yield* effect.pipe(
      Effect.provideService(
        CurrentRequest,
        CurrentRequest.of({
          request: args.request,
          url: new URL(args.request.url),
          origin: originFor(args.request, config.publicUrl),
          visitorId,
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
  if (Exit.isSuccess(exit)) return exit.value;

  const cause = exit.cause;
  const squashed = Cause.squash(cause);
  if (squashed instanceof Response) throw squashed;
  if (Cause.hasInterruptsOnly(cause)) {
    throw data<RouteErrorData>({ error: "Aborted", message: "Request aborted" }, { status: 499 });
  }
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    const error = failure.value as { readonly _tag?: string; readonly message?: string };
    const tag = error._tag ?? "Error";
    throw data<RouteErrorData>(
      { error: tag, message: error.message || "Something went wrong." },
      { status: STATUS_BY_TAG[tag] ?? 500 },
    );
  }
  await runtime.runPromise(Effect.logError(`Unhandled defect in ${name}`, cause)).catch(() => undefined);
  throw data<RouteErrorData>({ error: "InternalError", message: "Jev tripped over a cable. Try again." }, { status: 500 });
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
