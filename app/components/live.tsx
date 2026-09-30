import { useEffect, useState } from "react";

/** Re-renders every `intervalMs` so relative times and timers tick. */
export const useNow = (intervalMs = 1000, initial?: number): number => {
  const [now, setNow] = useState(initial ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
