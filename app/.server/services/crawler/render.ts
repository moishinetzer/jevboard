import { Duration, Effect, Option, Schema } from "effect";
import { CrawlError } from "../../domain/errors";
import type { FetchedPage } from "./fetch";
import { MAX_BODY_BYTES } from "./fetch";
import type { ExtractedPage } from "./html";

/**
 * Loads a page in a real browser, JavaScript on, and returns the HTML it
 * ends up with. For sites whose HTML is an empty app shell until their
 * JavaScript runs (single-page apps without server rendering).
 */
export type RenderPage = (url: string) => Effect.Effect<FetchedPage, CrawlError>;

/**
 * The slice of Cloudflare's Browser Run binding (`env.BROWSER`) the renderer
 * uses. Structural, so tests can pass a fake.
 */
export interface BrowserRunContent {
  quickAction(
    action: "content",
    options: {
      url: string;
      userAgent: string;
      gotoOptions: { waitUntil: "networkidle2"; timeout: number };
      rejectResourceTypes: Array<"image" | "media" | "font">;
      bestAttempt: boolean;
    },
  ): Promise<Response>;
}

const ContentReply = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.optional(Schema.String),
  meta: Schema.optional(
    Schema.Struct({
      status: Schema.optional(Schema.Number),
      finalUrl: Schema.optional(Schema.String),
    }),
  ),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(ContentReply));

/** Navigation budget inside the browser (Browser Run allows up to 60 s). */
const NAVIGATION_TIMEOUT_MS = 25_000;
const DEFAULT_TIMEOUT: Duration.Input = "40 seconds";

/**
 * Renders pages with Browser Run's `content` quick action. The browser
 * says it's JevBot (and Cloudflare marks it as a bot in headers nobody can
 * change); images, media and fonts are skipped since only the text matters.
 * Failures are CrawlErrors: a busy or broken renderer is "unreachable" (worth
 * another try), the page's own error status is "http".
 */
export const makeBrowserRenderer = (
  browser: BrowserRunContent,
  options: { readonly userAgent: string; readonly timeout?: Duration.Input },
): RenderPage =>
  Effect.fn("Crawler.render")(
    function* (url: string) {
      const fail = (reason: CrawlError["reason"], message: string, status?: number) =>
        Effect.fail(new CrawlError({ url, reason, message, ...(status === undefined ? {} : { status }) }));

      const { status, text } = yield* Effect.tryPromise({
        try: async () => {
          const response = await browser.quickAction("content", {
            url,
            userAgent: options.userAgent,
            gotoOptions: { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS },
            rejectResourceTypes: ["image", "media", "font"],
            // A page that never goes quiet (analytics, websockets) still returns what it has.
            bestAttempt: true,
          });
          return { status: response.status, text: await response.text() };
        },
        catch: (cause) =>
          new CrawlError({ url, reason: "unreachable", message: `the browser renderer failed (${String(cause).slice(0, 120)})` }),
      });

      const reply = decodeReply(text);
      if (status !== 200 || Option.isNone(reply) || !reply.value.success || reply.value.result === undefined) {
        const detail = Option.match(reply, {
          onNone: () => `HTTP ${status}`,
          onSome: (body) => body.errors?.[0]?.message ?? `HTTP ${status}`,
        });
        return yield* fail("unreachable", `the browser renderer said no (${detail.slice(0, 160)})`);
      }
      const pageStatus = reply.value.meta?.status;
      if (pageStatus !== undefined && (pageStatus < 200 || pageStatus > 299)) {
        return yield* fail("http", `HTTP ${pageStatus}`, pageStatus);
      }
      const html = reply.value.result;
      const page: FetchedPage = {
        url: reply.value.meta?.finalUrl ?? url,
        html: html.length > MAX_BODY_BYTES ? html.slice(0, MAX_BODY_BYTES) : html,
        truncated: html.length > MAX_BODY_BYTES,
      };
      return page;
    },
    (effect, url) =>
      Effect.timeoutOrElse(effect, {
        duration: options.timeout ?? DEFAULT_TIMEOUT,
        orElse: () =>
          Effect.fail(new CrawlError({ url, reason: "timeout", message: "the browser renderer took too long" })),
      }),
  );

/** Below this much visible text, a homepage is an empty shell. */
const EMPTY_SHELL_CHARS = 400;
/** A page with an app root or a "needs JavaScript" notice is a shell unless it has real text. */
const SPARSE_CHARS = 1_500;
const APP_ROOT = /<div\s+id=["'](?:root|app|__next|__nuxt|svelte|main)["'][^>]*>\s*<\/div>/i;
const NEEDS_JS = /<noscript[^>]*>[\s\S]{0,400}?(?:enable|requires?|need)[\s\S]{0,40}?javascript/i;

/**
 * Does this homepage only come alive with JavaScript? True for almost no
 * visible text, or little text plus an empty app root or a "please enable
 * JavaScript" notice. Server-rendered sites, however small, have their words
 * in the HTML and never pay for a browser.
 */
export const looksClientRendered = (html: string, page: ExtractedPage): boolean => {
  const chars = page.text.trim().length;
  if (chars < EMPTY_SHELL_CHARS) return true;
  return chars < SPARSE_CHARS && (APP_ROOT.test(html) || NEEDS_JS.test(html));
};
