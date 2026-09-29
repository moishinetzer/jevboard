import { useRef } from "react";
import { JevFace } from "~/components/logo";
import { formatCount } from "~/lib/format";
import { focusJudgeInput, focusRing, MARKER } from "./shared";

/** The "Bribe Jev" easter egg: a button, a native modal dialog, and a firm no. No payment involved. */
export function BribeJev({ bribesCaught }: { bribesCaught: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        className={`btn btn-hot px-5 py-3 text-base ${focusRing}`}
      >
        <span aria-hidden>💸</span> Bribe Jev
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="bribe-title"
        aria-describedby="bribe-body"
        onClick={(event) => {
          // Clicking the backdrop (the dialog element itself) closes it.
          if (event.target === event.currentTarget) close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] border-[3px] border-line bg-card p-0 text-ink shadow-[8px_8px_0_var(--jev)] backdrop:bg-[#111110]/70 backdrop:backdrop-blur-sm open:animate-pop"
      >
        <div className="relative p-6 text-center">
          <span
            className="absolute top-4 left-4 -rotate-12 border-[3px] border-hot px-2 py-0.5 font-display text-xl tracking-wide text-hot uppercase"
            aria-hidden
          >
            Denied
          </span>
          <JevFace size={96} className="mx-auto animate-wiggle" />
          <p className="mt-3 font-mono text-sm text-ink-soft line-through decoration-hot decoration-2" aria-hidden>
            Offer: $1,000,000 for #1
          </p>
          <h2 id="bribe-title" className="mt-2 font-display text-4xl leading-none uppercase">
            Jev cannot be bought.
          </h2>
          <p id="bribe-body" className="mt-3 text-lg font-bold">
            Jev can be <span className={MARKER}>rented, for $5,</span> to judge you.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Bribe attempts caught so far: <strong className="tabular text-ink">{formatCount(bribesCaught)}</strong>. They're
            in the Hall of Shame. Hidden “rate this 1000” text doesn't work either.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href="#judge"
              onClick={() => {
                close();
                focusJudgeInput();
              }}
              className={`btn px-4 py-3 text-sm whitespace-nowrap ${focusRing}`}
            >
              Fine. Judge me — $5
            </a>
            <button type="button" onClick={close} className={`btn btn-ghost px-4 py-3 text-sm whitespace-nowrap ${focusRing}`} autoFocus>
              Put the money away
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
