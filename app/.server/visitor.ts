import { createContext, type MiddlewareFunction } from "react-router";
import { makeCustomerId } from "./domain/ids";

/**
 * Anonymous visitor identity.
 *
 * Jevboard has no accounts: every browser gets a random, httpOnly `jev_vid`
 * cookie. The same id is the Autumn customer id, so judgment credits bought
 * from this browser belong to it.
 */
export interface Visitor {
  readonly id: string;
  readonly isNew: boolean;
}

export const visitorContext = createContext<Visitor | null>(null);

const COOKIE = "jev_vid";
const VALID_ID = /^c[0-9A-Za-z]{22}$/;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const readCookie = (header: string | null, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
};

/** Machine endpoints never get a visitor cookie. */
const MACHINE_PATHS = /^\/(api\/autumn|badge|og|healthz)/;

export const visitorMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  if (MACHINE_PATHS.test(new URL(request.url).pathname)) {
    context.set(visitorContext, { id: "machine", isNew: false });
    return next();
  }
  const existing = readCookie(request.headers.get("Cookie"), COOKIE);
  const visitor: Visitor =
    existing && VALID_ID.test(existing) ? { id: existing, isNew: false } : { id: makeCustomerId(), isNew: true };
  context.set(visitorContext, visitor);

  const response = await next();
  if (visitor.isNew) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    try {
      response.headers.append(
        "Set-Cookie",
        `${COOKIE}=${visitor.id}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
      );
    } catch {
      // Immutable headers (e.g. a proxied fetch Response) — the visitor just gets a new id next time.
    }
  }
  return response;
};
