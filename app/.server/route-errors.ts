import { Cause, Exit, Option } from "effect";
import { data } from "react-router";

/** Body of every error response thrown to a route ErrorBoundary. */
export interface RouteErrorData {
  readonly error: string;
  readonly message: string;
}

/** Error tag → HTTP status. Anything else is a 500. */
export const STATUS_BY_TAG: Readonly<Record<string, number>> = {
  InvalidSite: 400,
  SchemaError: 400,
  NotFound: 404,
  CrawlError: 422,
  PaymentError: 502,
  JudgeError: 502,
};

export type RouteOutcome<A> =
  | { readonly _tag: "Return"; readonly value: A }
  /** Throw `thrown` from the loader/action; log `defect` first when present. */
  | { readonly _tag: "Throw"; readonly thrown: unknown; readonly defect?: Cause.Cause<unknown> };

/**
 * Maps an Effect Exit to what a React Router loader/action should do:
 * - success → return the value (including `redirect()` Responses)
 * - a Response anywhere in the cause (e.g. `Effect.die(data(..., 404))`) → throw it as is
 * - interruption (client went away) → 499
 * - typed failure → `data({ error: _tag, message }, { status })` via STATUS_BY_TAG
 * - defect → generic 500 (details only in the logs)
 */
export const toRouteOutcome = <A, E>(exit: Exit.Exit<A, E>): RouteOutcome<A> => {
  if (Exit.isSuccess(exit)) return { _tag: "Return", value: exit.value };
  const cause = exit.cause;

  const squashed = Cause.squash(cause);
  if (squashed instanceof Response || isDataWithResponseInit(squashed)) return { _tag: "Throw", thrown: squashed };

  if (Cause.hasInterruptsOnly(cause)) {
    return { _tag: "Throw", thrown: data<RouteErrorData>({ error: "Aborted", message: "Request aborted" }, { status: 499 }) };
  }

  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    const error = failure.value as { readonly _tag?: string; readonly message?: string };
    const tag = error._tag ?? "Error";
    const status = STATUS_BY_TAG[tag] ?? 500;
    return {
      _tag: "Throw",
      thrown: data<RouteErrorData>({ error: tag, message: error.message || "Something went wrong." }, { status }),
      ...(status >= 500 ? { defect: cause } : {}),
    };
  }

  return {
    _tag: "Throw",
    thrown: data<RouteErrorData>({ error: "InternalError", message: "Jev tripped over a cable. Try again." }, { status: 500 }),
    defect: cause,
  };
};

/** `data()` results are plain objects tagged by React Router. */
const isDataWithResponseInit = (value: unknown): boolean =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "DataWithResponseInit";
