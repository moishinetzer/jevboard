import { CONTACT_EMAIL } from "./content";

const FACTS = [
  ["When", "Only when someone asks: a quick check when a URL is submitted, then one crawl per judgment. No background crawling."],
  ["What", "Your homepage plus up to three pages it links to on the same site. Never links off-site."],
  ["How", "Plain HTTP GETs. No JavaScript, no cookies, no logins, no forms."],
  ["Limits", "Public http(s) addresses only. Up to 12 seconds, 1.5 MB and 5 redirects per page."],
] as const;

/** "JevBot": what the crawler is and how to recognise it. Linked from the user agent. */
export function JevBotSection({ userAgent }: { userAgent: string }) {
  return (
    <section id="jevbot" aria-labelledby="jevbot-title" className="panel mt-10 scroll-mt-6 px-5 py-6 sm:px-[30px] sm:py-7">
      <h2 id="jevbot-title" className="font-display text-2xl font-extrabold tracking-[-0.02em] sm:text-[28px]">
        JevBot, Jev's crawler
      </h2>
      <p className="mt-1.5 text-[15px] text-soft">
        It fetches a handful of public pages once per paid judgment, so Jev can read them.
      </p>
      <p className="mt-4 text-sm font-semibold">It always says who it is:</p>
      <code className="mt-2 block rounded-xl bg-pill px-3.5 py-2.5 text-[13px] leading-relaxed wrap-anywhere">{userAgent}</code>
      <dl className="mt-5 grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-[15px] leading-[1.55] sm:grid-cols-[90px_minmax(0,1fr)] sm:gap-x-5">
        {FACTS.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="font-bold">{term}</dt>
            <dd className="text-soft">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm text-soft">
        Rather not be crawled? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("JevBot opt-out")}`} className="link">
          {CONTACT_EMAIL}
        </a>{" "}
        with your domain.
      </p>
    </section>
  );
}
