import { Effect } from "effect";
import type { BoardEvent } from "../domain/models";
import { Board } from "../services/Board";
import { Judge } from "../services/Judge";
import { Payments } from "../services/Payments";
import { Presence } from "../services/Presence";

/** Live counters shown in the header strip, hero and footer. */
export interface LiveCounters {
  readonly online: number;
  readonly judgingNow: number;
  readonly judgments: number;
  readonly entries: number;
  readonly rerolls: number;
  readonly revenueCents: number;
  readonly visitors: number;
  readonly launchedAt: number | null;
  readonly king: { readonly siteKey: string; readonly score: number; readonly since: number } | null;
}

export interface ShellData {
  readonly mode: { readonly payments: "autumn" | "fake"; readonly judge: "live" | "mock" };
  readonly counters: LiveCounters;
  /** Latest events for "The Tape", newest first. */
  readonly tape: ReadonlyArray<BoardEvent>;
  readonly now: number;
}

/** Per-isolate cache: every open tab polls the feed, the counters needn't be fresher than this. */
const COUNTERS_TTL_MS = 3000;
let countersCache: { readonly at: number; readonly value: LiveCounters } | undefined;

export const loadCounters = Effect.suspend(() =>
  countersCache && Date.now() - countersCache.at < COUNTERS_TTL_MS
    ? Effect.succeed(countersCache.value)
    : computeCounters.pipe(Effect.tap((value) => Effect.sync(() => (countersCache = { at: Date.now(), value })))),
);

const computeCounters = Effect.gen(function* () {
  const board = yield* Board;
  const stats = yield* board.stats;
  const online = yield* (yield* Presence).online;
  return {
    online,
    judgingNow: stats.judgingNow,
    judgments: stats.judgments,
    entries: stats.entries,
    rerolls: stats.rerolls,
    revenueCents: stats.revenueCents,
    visitors: stats.visitors,
    launchedAt: stats.launchedAt,
    king: stats.king ? { siteKey: stats.king.siteKey, score: stats.king.score, since: stats.king.since } : null,
  } satisfies LiveCounters;
});

/** Root loader data: shared by every page. */
export const loadShell = Effect.gen(function* () {
  const board = yield* Board;
  const judge = yield* Judge;
  const payments = yield* Payments;
  const counters = yield* loadCounters;
  const tape = yield* board.events({ limit: 25 });
  return {
    mode: { payments: payments.kind, judge: judge.kind },
    counters,
    tape,
    now: Date.now(),
  } satisfies ShellData;
});

/** Poll endpoint for The Tape and live counters (/api/feed?after=<eventId>). */
export const loadFeed = Effect.fn("loadFeed")(function* (afterId: number | undefined) {
  const board = yield* Board;
  const events = yield* board.events({ afterId, limit: 25 });
  const counters = yield* loadCounters;
  return { events, counters, now: Date.now() };
});
