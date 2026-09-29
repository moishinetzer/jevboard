import { describe, expect, it } from "vitest";
import { Effect, Exit, Fiber } from "effect";
import { data, redirect } from "react-router";
import { NotFound, PaymentError } from "~/.server/domain/errors";
import { toRouteOutcome } from "~/.server/route-errors";

const outcomeOf = <A, E>(effect: Effect.Effect<A, E>) => toRouteOutcome(Effect.runSyncExit(effect));

const thrownStatus = (outcome: ReturnType<typeof toRouteOutcome>) => {
  if (outcome._tag !== "Throw") throw new Error("expected a throw");
  const thrown = outcome.thrown as { init?: { status?: number }; status?: number; data?: unknown };
  return { status: thrown.init?.status ?? thrown.status, data: thrown.data, defect: "defect" in outcome && outcome.defect !== undefined };
};

describe("toRouteOutcome", () => {
  it("returns successful values, including redirect responses", () => {
    expect(outcomeOf(Effect.succeed({ ok: 1 }))).toEqual({ _tag: "Return", value: { ok: 1 } });
    const response = redirect("/somewhere");
    const outcome = outcomeOf(Effect.succeed(response));
    expect(outcome._tag === "Return" && outcome.value).toBe(response);
  });

  it("maps typed failures to statuses with their message", () => {
    expect(thrownStatus(outcomeOf(Effect.fail(new NotFound({ what: "entry", message: "Nope." }))))).toEqual({
      status: 404,
      data: { error: "NotFound", message: "Nope." },
      defect: false,
    });
    const payment = thrownStatus(outcomeOf(Effect.fail(new PaymentError({ message: "Autumn down" }))));
    expect(payment.status).toBe(502);
    expect(payment.defect).toBe(true);
  });

  it("passes through Responses and data() thrown as defects", () => {
    const notFound = data({ error: "NotFound", message: "x" }, { status: 404 });
    const outcome = outcomeOf(Effect.die(notFound));
    expect(outcome._tag === "Throw" && outcome.thrown).toBe(notFound);
    const response = new Response("hi", { status: 418 });
    const raw = outcomeOf(Effect.die(response));
    expect(raw._tag === "Throw" && raw.thrown).toBe(response);
  });

  it("hides defect details behind a 500 but keeps the cause for logging", () => {
    const result = thrownStatus(outcomeOf(Effect.die(new Error("secret stack"))));
    expect(result.status).toBe(500);
    expect(result.defect).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain("secret");
  });

  it("maps interruption to 499", async () => {
    const fiber = Effect.runFork(Effect.never);
    const exit = await Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber))));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(thrownStatus(toRouteOutcome(exit)).status).toBe(499);
  });
});
