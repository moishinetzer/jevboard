import { Effect } from "effect";
import { Judge } from "../services/Judge";
import { Payments } from "../services/Payments";

export interface ShellData {
  readonly mode: { readonly payments: "autumn" | "fake"; readonly judge: "live" | "mock" };
}

/** Root loader data: shared by every page. */
export const loadShell = Effect.gen(function* () {
  const judge = yield* Judge;
  const payments = yield* Payments;
  return { mode: { payments: payments.kind, judge: judge.kind } } satisfies ShellData;
});
