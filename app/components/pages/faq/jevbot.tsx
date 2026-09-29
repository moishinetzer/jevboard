import { JevFace } from "~/components/logo";
import { CONTACT_EMAIL } from "./content";

const FACTS = [
  ["When", "Only when someone asks. A quick check of your homepage when a URL is submitted, then one crawl per paid judgment or retrial. No background crawling, no schedule."],
  ["What", "Your homepage plus up to three pages it links to on the same site (about, pricing, docs and the like). Never links off-site."],
  ["How", "Plain HTTP GETs. No JavaScript, no cookies, no logins, no forms, no clicking “Book a demo”."],
  ["Limits", "Public http(s) addresses only; private and internal networks are refused. Up to 12 seconds, 1.5 MB and 5 redirects per page."],
] as const;

/** "JevBot": what the crawler is and how to recognise it. Linked from the user agent. */
export function JevBotSection({ userAgent }: { userAgent: string }) {
  return (
    <section id="jevbot" aria-labelledby="jevbot-title" className="scroll-mt-32 border-[3px] border-line bg-paper-2 p-5 shadow-[6px_6px_0_var(--shadow)] sm:p-8">
      <div className="flex items-start gap-4">
        <JevFace size={56} className="hidden shrink-0 sm:block" />
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-hot">Seen us in your logs?</p>
          <h2 id="jevbot-title" className="mt-1 font-display text-4xl uppercase leading-none sm:text-5xl">
            JevBot, Jev's crawler
          </h2>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-lg">
        JevBot fetches a handful of public pages from a website <strong>once per paid judgment</strong>, so Jev can read them. It always
        says who it is:
      </p>
      <pre className="mt-4 overflow-x-auto border-2 border-line bg-card p-3 text-sm">
        <code className="tabular">{userAgent}</code>
      </pre>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        {FACTS.map(([term, detail]) => (
          <div key={term} className="border-l-4 border-jev-deep pl-3">
            <dt className="font-bold uppercase tracking-wide">{term}</dt>
            <dd className="mt-1 text-ink-soft">{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm text-ink-soft">
        Rather not be judged? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("JevBot opt-out")}`} className="font-bold text-ink underline">
          {CONTACT_EMAIL}
        </a>{" "}
        with your domain and a human will take it off the docket. JevBot never visits a site nobody has asked about.
      </p>
    </section>
  );
}
