import type { Intake } from "./models";

/** Length caps for what a buyer can type (Jev's prompt stays small; nothing here is shown publicly). */
export const INTAKE_LIMITS = {
  summary: 200,
  label: 40,
  audiences: 6,
  strengths: 3,
  note: 280,
} as const;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return cleaned === "" ? null : cleaned;
};

const labels = (value: unknown, count: number): ReadonlyArray<string> =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, INTAKE_LIMITS.label)).filter((item): item is string => item !== null))].slice(0, count)
    : [];

/** A landing page is only kept when it's http(s) on the site's own host (www or not). */
const sameSiteUrl = (value: unknown, siteUrl: string): string | null => {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    const site = new URL(siteUrl);
    const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || bare(url.hostname) !== bare(site.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * The guided onboarding's answers as the browser sent them (JSON), cleaned
 * and capped. Null when nothing usable came through.
 */
export const parseIntake = (raw: unknown, siteUrl: string): Intake | null => {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 5_000) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const intake: Intake = {
    summary: text(record["summary"], INTAKE_LIMITS.summary),
    audiences: labels(record["audiences"], INTAKE_LIMITS.audiences),
    strengths: labels(record["strengths"], INTAKE_LIMITS.strengths),
    note: text(record["note"], INTAKE_LIMITS.note),
    landingUrl: sameSiteUrl(record["landingUrl"], siteUrl),
  };
  const empty =
    intake.summary === null &&
    intake.audiences.length === 0 &&
    intake.strengths.length === 0 &&
    intake.note === null &&
    intake.landingUrl === null;
  return empty ? null : intake;
};

/** A stored intake (orders.intake_json), trusted as far as its shape. */
export const readIntake = (json: string | null | undefined): Intake | null => {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<Intake>;
    return {
      summary: typeof value.summary === "string" ? value.summary : null,
      audiences: Array.isArray(value.audiences) ? value.audiences.filter((item): item is string => typeof item === "string") : [],
      strengths: Array.isArray(value.strengths) ? value.strengths.filter((item): item is string => typeof item === "string") : [],
      note: typeof value.note === "string" ? value.note : null,
      landingUrl: typeof value.landingUrl === "string" ? value.landingUrl : null,
    };
  } catch {
    return null;
  }
};
