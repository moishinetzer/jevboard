import { useEffect, useRef } from "react";

/**
 * Browsers keep a page in memory when you leave it and show it again,
 * unchanged, on Back. A form that was mid-submit when the buyer left for
 * checkout would come back stuck on "Opening checkout…" with its button
 * disabled. When that happens, load the page afresh.
 */
export function useReloadIfRestoredBusy(busy: boolean) {
  const wasBusy = useRef(busy);
  wasBusy.current = busy;
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted && wasBusy.current) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
}
