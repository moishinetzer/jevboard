import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardEvent } from "~/.server/domain/models";
import type { LiveCounters } from "~/.server/flows/shell";

/**
 * Live data for the whole page: The Tape (event feed) and the counters.
 * Seeded from the root loader, then refreshed by polling /api/feed.
 */
interface LiveState {
  readonly tape: ReadonlyArray<BoardEvent>;
  readonly counters: LiveCounters;
  /** Ids of events that arrived after page load (for "new" highlights). */
  readonly fresh: ReadonlySet<number>;
  readonly now: number;
}

const LiveContext = createContext<LiveState | null>(null);

const POLL_MS = 5000;

export function LiveProvider(props: {
  readonly tape: ReadonlyArray<BoardEvent>;
  readonly counters: LiveCounters;
  readonly now: number;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<LiveState>({
    tape: props.tape,
    counters: props.counters,
    fresh: new Set(),
    now: props.now,
  });
  const lastId = useRef(props.tape[0]?.id ?? 0);

  // Loader revalidations (after actions / navigations) bring fresher counters.
  useEffect(() => {
    setState((current) => ({ ...current, counters: props.counters }));
  }, [props.counters]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(`/api/feed?after=${lastId.current}`, { headers: { accept: "application/json" } });
          if (response.ok) {
            const body = (await response.json()) as {
              events: ReadonlyArray<BoardEvent>;
              counters: LiveCounters;
              now: number;
            };
            if (!cancelled) {
              if (body.events.length > 0) lastId.current = Math.max(lastId.current, ...body.events.map((e) => e.id));
              setState((current) => {
                const known = new Set(current.tape.map((event) => event.id));
                const incoming = body.events.filter((event) => !known.has(event.id));
                const fresh = new Set(current.fresh);
                for (const event of incoming) fresh.add(event.id);
                return {
                  tape: [...incoming, ...current.tape].sort((a, b) => b.id - a.id).slice(0, 40),
                  counters: body.counters,
                  fresh,
                  now: body.now,
                };
              });
            }
          }
        } catch {
          // Offline or server restarting; try again next tick.
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <LiveContext.Provider value={state}>{props.children}</LiveContext.Provider>;
}

export const useLive = (): LiveState => {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside <LiveProvider>");
  return value;
};

/** Re-renders every `intervalMs` so relative times / reign timers tick. */
export const useNow = (intervalMs = 1000, initial?: number): number => {
  const [now, setNow] = useState(initial ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
