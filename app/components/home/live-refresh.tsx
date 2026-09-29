import { useState } from "react";
import { useRevalidator } from "react-router";
import type { EventKind } from "~/.server/domain/models";
import { useLive } from "~/components/live";
import { focusRing } from "./shared";

/** Tape events that change what the board shows. */
const BOARD_EVENTS: ReadonlySet<EventKind> = new Set(["placed", "rerolled", "crowned", "dethroned"]);

/**
 * A floating "🔔 3 new verdicts · Refresh the board" pill, driven by the
 * live tape. Turns into a "NEW #1" alert when the throne changes hands.
 * The board only reloads when the reader asks, so nothing jumps under them.
 */
export function LiveRefresh({ kingSiteKey }: { kingSiteKey: string | null }) {
  const { tape, fresh, counters } = useLive();
  const revalidator = useRevalidator();
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());

  const pending = tape.filter((event) => fresh.has(event.id) && !seen.has(event.id) && BOARD_EVENTS.has(event.kind));
  const newKing = counters.king && counters.king.siteKey !== kingSiteKey ? counters.king.siteKey : null;
  const show = pending.length > 0 || newKing !== null;
  const busy = revalidator.state !== "idle";

  const refresh = () => {
    setSeen(new Set(fresh));
    void revalidator.revalidate();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" aria-live="polite">
      {show ? (
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className={`pointer-events-auto flex max-w-full animate-pop items-center gap-2 border-[3px] border-[#111110] px-4 py-2.5 text-left text-sm font-bold shadow-[5px_5px_0_#111110] transition-transform hover:-translate-y-0.5 ${
            newKing ? "bg-hot text-white" : "bg-jev text-[#111110]"
          } ${focusRing}`}
        >
          <span className="text-lg" aria-hidden>
            {newKing ? "👑" : "🔔"}
          </span>
          <span className="min-w-0 truncate">
            {newKing
              ? `NEW #1: ${newKing} took the throne.`
              : `${pending.length} new verdict${pending.length === 1 ? "" : "s"} landed.`}
          </span>
          <span className="shrink-0 underline decoration-2 underline-offset-2">{busy ? "Refreshing…" : "Refresh the board"}</span>
        </button>
      ) : null}
    </div>
  );
}
