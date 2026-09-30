import { useEffect, useState } from "react";
import { JevFace } from "~/components/logo";
import { Favicon } from "~/components/ui";
import { CopyButton } from "./copy-button";
import { ImageWithStandIn, Segmented } from "./controls";
import { ogPath } from "./links";
import { linkedInShareUrl, shareMessage, xIntentUrl, type ShareFacts, type ShareVoice } from "./share-copy";

const VOICES = [
  { value: "defendant", label: "I'm the defendant" },
  { value: "spectator", label: "I'm just watching" },
] as const;

/**
 * One-click sharing: a live preview of the post (text + share card), then
 * X, LinkedIn, copy and the native share sheet where there is one.
 */
export function SharePanel({
  facts,
  name,
  serial,
  allowVoiceChoice = false,
}: {
  facts: ShareFacts;
  name: string;
  /** "#0042" — printed on the share card stand-in. */
  serial: string;
  /** Let spectators switch the copy from "we" to "they". */
  allowVoiceChoice?: boolean;
}) {
  const [voice, setVoice] = useState<ShareVoice>("defendant");
  const message = shareMessage(facts, voice);
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => setCanNativeShare(typeof navigator.share === "function"), []);

  const host = facts.siteKey.split("/")[0] ?? facts.siteKey;

  return (
    <div className="grid gap-4">
      {allowVoiceChoice ? <Segmented legend="Share as" value={voice} options={VOICES} onChange={setVoice} /> : null}

      <figure className="slab-sm p-3 sm:p-4">
        <figcaption className="sr-only">Preview of your post</figcaption>
        <div className="flex items-start gap-3">
          {voice === "defendant" ? (
            <Favicon host={host} size={40} />
          ) : (
            <span
              className="grid size-10 shrink-0 place-items-center border-2 border-line bg-paper-2 text-xl"
              aria-hidden
            >
              👀
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-bold">{voice === "defendant" ? name : "You"}</span>{" "}
              <span className="text-ink-soft">· just now</span>
            </p>
            <p className="mt-1 text-[15px] leading-snug [overflow-wrap:anywhere]">
              {message.body} <span className="underline decoration-2 underline-offset-2">{facts.url}</span>
            </p>
            <div className="mt-3 overflow-hidden rounded-xl border-2 border-line">
              <ImageWithStandIn
                key={facts.siteKey}
                src={ogPath(facts.siteKey)}
                alt={`Share card: ${facts.siteKey} scored ${facts.score}/1000 on Jevboard`}
                imgClassName="aspect-[1200/630] w-full object-cover"
                standIn={<ShareCardStandIn facts={facts} serial={serial} />}
              />
            </div>
          </div>
        </div>
      </figure>

      <div className="flex flex-wrap gap-2.5">
        <a
          href={xIntentUrl(message.full)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn px-4 py-2.5 text-sm"
        >
          Post on 𝕏
        </a>
        <a
          href={linkedInShareUrl(facts.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost px-4 py-2.5 text-sm"
        >
          LinkedIn
        </a>
        <CopyButton text={facts.url} label="Copy link" className="btn btn-ghost px-4 py-2.5 text-sm" />
        <CopyButton text={message.full} label="Copy post" className="btn btn-ghost px-4 py-2.5 text-sm" />
        {canNativeShare ? (
          <button
            type="button"
            className="btn btn-ghost px-4 py-2.5 text-sm"
            onClick={() => {
              navigator
                .share({ title: `${facts.siteKey} on Jevboard`, text: message.body, url: facts.url })
                .catch(() => {
                  // Dismissed by the user.
                });
            }}
          >
            Share…
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Look-alike of the /og/<siteKey>.png card, drawn with CSS (scales with its container). */
function ShareCardStandIn({ facts, serial }: { facts: ShareFacts; serial: string }) {
  return (
    <div className="@container aspect-[1200/630] w-full overflow-hidden bg-jev text-[#111110]">
      <div className="flex h-full flex-col justify-between p-[5cqw]">
        <div className="flex items-center justify-between gap-[2cqw]">
          <span className="flex items-center gap-[1.5cqw] font-display text-[5.5cqw] uppercase leading-none">
            <JevFace className="size-[8cqw]" />
            <span>
              Jev<span className="text-hot">board</span>
            </span>
          </span>
          <span className="border-[0.4cqw] border-[#111110] px-[1.2cqw] py-[0.4cqw] font-mono text-[2.3cqw] font-bold uppercase">
            Judgment {serial}
          </span>
        </div>
        <div className="flex items-end justify-between gap-[3cqw]">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[7cqw] uppercase leading-[0.95] [overflow-wrap:anywhere]">
              {facts.siteKey}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-[19cqw] leading-[0.8]">{facts.score}</p>
            <p className="mt-[1cqw] font-mono text-[2.6cqw] font-bold uppercase">
              /1000 · #{facts.rank} of {facts.total}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
