import type { SiteSnapshot } from "../../domain/models";

/**
 * Receipts are published as verbatim quotes from the site, so a quote Jev
 * can't back up with text it actually read (the crawler snapshot) is dropped
 * rather than attributed to a real business.
 *
 * Matching is forgiving about typography (case, whitespace, curly quotes,
 * dashes, surrounding quote marks and ellipses) but not about words.
 */

const normalize = (text: string): string =>
  text
    .normalize("NFKC") // also turns U+2026 into "..." and non-breaking spaces into spaces
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** Drops surrounding quote marks, leading/trailing ellipses and trailing punctuation. */
const stripWrapping = (text: string): string =>
  text
    .trim()
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/^(?:\.\.\.|\u2026)\s*|\s*(?:\.\.\.|\u2026)$/g, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();

/** All text Jev saw: the crawler snapshot. */
export const evidenceCorpus = (snapshot: SiteSnapshot): string => {
  const parts: Array<string> = [snapshot.title, snapshot.description];
  for (const page of snapshot.pages) parts.push(page.title, page.description, ...page.headings, page.text);
  return normalize(parts.join("\n"));
};

/** Keeps the receipts that appear in the corpus (fragments around an ellipsis must each appear). */
export const verifyReceipts = (
  receipts: ReadonlyArray<string>,
  corpus: string,
): { readonly kept: Array<string>; readonly dropped: Array<string> } => {
  const kept: Array<string> = [];
  const dropped: Array<string> = [];
  for (const receipt of receipts) {
    const fragments = normalize(stripWrapping(receipt))
      .split(/\s*(?:\.\.\.|\u2026)\s*/)
      .map(stripWrapping)
      .filter((fragment) => fragment.length > 0);
    const found = fragments.length > 0 && fragments.every((fragment) => corpus.includes(fragment));
    (found ? kept : dropped).push(receipt);
  }
  return { kept, dropped };
};
