import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";
import { AppConfig } from "~/.server/config";
import type { SiteSnapshot } from "~/.server/domain/models";
import { Judge } from "~/.server/services/Judge";
import { ClaudeJudgeLive } from "~/.server/services/judge/ClaudeJudge";

/**
 * Real calls to the Claude API. Skipped unless ANTHROPIC_API_KEY is set:
 *   ANTHROPIC_API_KEY=sk-... npx vitest run test/judge.live.test.ts
 */
const apiKey = process.env["ANTHROPIC_API_KEY"];

const snapshot: SiteSnapshot = {
  requestedUrl: "https://www.openstreetmap.org",
  finalUrl: "https://www.openstreetmap.org/",
  host: "www.openstreetmap.org",
  title: "OpenStreetMap",
  description: "OpenStreetMap is a map of the world, created by people like you and free to use under an open license.",
  ogImage: null,
  favicon: null,
  pages: [
    {
      url: "https://www.openstreetmap.org/",
      title: "OpenStreetMap",
      description: "OpenStreetMap is a map of the world, created by people like you and free to use under an open license.",
      headings: ["Welcome to OpenStreetMap!"],
      text: "OpenStreetMap is a map of the world, created by people like you and free to use under an open license. Hosting is supported by UCL, Fastly, Bytemark Hosting, and other partners.",
    },
  ],
  fetchedAt: Date.now(),
};

const layer = ClaudeJudgeLive.pipe(
  Layer.provide(
    AppConfig.layerTest({
      anthropic: Option.some({
        apiKey: Redacted.make(apiKey ?? ""),
        model: process.env["JEV_MODEL"] ?? "claude-opus-5-5",
        judgeEffort: "low",
        duelEffort: "low",
      }),
    }),
  ),
);

describe.skipIf(!apiKey)("ClaudeJudge (live API)", () => {
  it.live(
    "judges a real site end to end",
    () =>
      Effect.gen(function* () {
        const judge = yield* Judge;
        const result = yield* judge.judge({
          siteKey: "openstreetmap.org",
          url: "https://www.openstreetmap.org",
          snapshot,
          roll: 1,
          fresh: true,
        });
        console.log(JSON.stringify(result, null, 2));
        expect(result.verdict.score).toBeGreaterThan(700);
        expect(result.verdict.contentFlag).toBe("none");
        expect(result.verdict.label).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
      }).pipe(Effect.provide(layer)),
    600_000,
  );

  it.live(
    "settles a duel",
    () =>
      Effect.gen(function* () {
        const judge = yield* Judge;
        const verdict = yield* judge.duel({
          score: 512,
          a: {
            siteKey: "openstreetmap.org",
            name: "OpenStreetMap",
            label: "the-map-the-internet-runs-on",
            tldr: "A free, editable map of the whole world.",
            category: "Nonprofit",
            reasoning: "Used by countless apps and humanitarian teams.",
            strengths: ["Open data", "Global coverage"],
            weaknesses: ["Plain homepage"],
          },
          b: {
            siteKey: "example-waitlist.ai",
            name: "SynergyGPT",
            label: "another-ai-wrapper-with-a-waitlist-and-a-gradient",
            tldr: "An AI assistant with a waitlist and no product details.",
            category: "AI",
            reasoning: "No evidence of a working product.",
            strengths: ["Nice gradient"],
            weaknesses: ["Waitlist only", "No pricing"],
          },
        });
        console.log(verdict);
        expect(verdict.winner).toBe("A");
      }).pipe(Effect.provide(layer)),
    120_000,
  );
});
