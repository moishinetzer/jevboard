/**
 * E2E harness: boots the real, built Jevboard Worker in workerd, in simulated mode
 * (checkout simulator at /dev/checkout/:orderId + deterministic mock Jev).
 *
 * Run it with `pnpm test:e2e` (vitest.e2e.config.ts; about 15 s). Nothing else needs to
 * be running, and a `pnpm dev` on :5173 is left alone: `startJevboard()` builds, boots,
 * migrates and checks the mode by itself, and `close()` tears it all down. Needs outbound
 * internet: the crawler really fetches the submitted sites (example.com and friends) and
 * resolves them over DNS-over-HTTPS, because it refuses private addresses by design.
 * The tests in worker.test.ts share one board and run in order (the reroll needs the
 * first judgment); when one fails, the Worker's recent log lines are printed.
 *
 * How it works
 * 1. `react-router build` produces the same bundle `wrangler deploy` uploads, plus the
 *    generated build/server/wrangler.json (D1, both queues and their consumers, the cron
 *    trigger, the rate limiters).
 * 2. The build is copied to a fresh temp dir, without the `.dev.vars` the Cloudflare
 *    Vite plugin copies next to it, and `migrations_dir` is pointed back at migrations/.
 * 3. wrangler's `createTestHarness` runs it in workerd on a free port (port 0), with
 *    Miniflare's non-persistent storage: every run starts from an empty D1, empty
 *    queues and empty rate-limit buckets. `applyD1Migrations("DB")` then applies
 *    migrations/ the same way `wrangler d1 migrations apply --local` does.
 * 4. The cron trigger is fired with `worker.scheduled()` (Miniflare's
 *    /cdn-cgi/local/scheduled); queue consumers run on their own as in `wrangler dev`.
 *
 * Why this runner: `vite dev` compiles on demand and re-optimises dependencies, which
 * can restart the Worker in the middle of a queued judgment, and its persistence dir and
 * env files are fixed by vite.config.ts. `wrangler dev` as a child process would need
 * port management and stdout scraping. The harness runs the deployable bundle in-process
 * and hands us `scheduled()`, `applyD1Migrations()`, `getEnv()` and the Worker's logs.
 *
 * Never real keys: wrangler would read secrets from a `.dev.vars` next to the config, from
 * `.env` files, or (opt-in) from process.env, and the developer's checkout has real ones.
 * So the build output is copied without `.dev.vars`, `.env` loading is switched off
 * (CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false), CLOUDFLARE_INCLUDE_PROCESS_ENV and
 * CLOUDFLARE_ENV are cleared, and the provider keys are removed from this process's
 * environment. Before handing the Worker out, the harness checks that none of
 * OPENROUTER_API_KEY / AUTUMN_SECRET_KEY / AUTUMN_WEBHOOK_SECRET is bound and that the
 * home page shows the simulated-mode banner. On top of that, outbound requests to
 * OpenRouter or Autumn are refused (the Worker's outbound fetches go through this
 * process's `fetch`) and recorded, so a test can assert there were none.
 *
 * The build runs in production mode (NODE_ENV=production inside the Worker), where the
 * app refuses to start without real providers unless JEV_ALLOW_FAKE_PAYMENTS and
 * JEV_ALLOW_MOCK_JUDGE are set: the harness sets both, as a staging deploy would.
 */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { D1Database } from "@cloudflare/workers-types";
import { createTestHarness } from "wrangler";

const ROOT = resolve(import.meta.dirname, "../../..");

/** Must never reach the Worker: their presence switches it to the real providers. */
export const PROVIDER_SECRETS = ["OPENROUTER_API_KEY", "AUTUMN_SECRET_KEY", "AUTUMN_WEBHOOK_SECRET"] as const;

/** Hosts the e2e suite must never talk to. */
const FORBIDDEN_HOST = /(^|\.)(openrouter\.ai|useautumn\.com)$/i;

export interface OrderRow {
  readonly status: string;
  readonly kind: string;
  readonly paidAt: number | null;
  readonly judgmentId: string | null;
}

export interface Jevboard {
  /** e.g. http://127.0.0.1:61234 */
  readonly baseUrl: URL;
  /** Fires the Worker's `scheduled` handler (the every-minute cron). */
  readonly scheduled: () => Promise<{ readonly outcome: string }>;
  /** Peeks at an order row in D1 (state the browser can't see without side effects). */
  readonly order: (orderId: string) => Promise<OrderRow | null>;
  /** True once the checkout simulator recorded a payment for the order. */
  readonly simulatorPaid: (orderId: string) => Promise<boolean>;
  /** A board entry's current score and roll count, or null when the site isn't on the board. */
  readonly entry: (siteKey: string) => Promise<{ readonly score: number; readonly rolls: number } | null>;
  /** All views recorded for a site key ('' is the board as a whole). */
  readonly views: (siteKey: string) => Promise<number>;
  /** Outbound requests to OpenRouter or Autumn that were refused (should stay empty). */
  readonly forbiddenCalls: ReadonlyArray<string>;
  /** The Worker's most recent log lines, for failure messages. */
  readonly recentLogs: (count?: number) => string;
  readonly close: () => Promise<void>;
}

/** Environment for the build: no provider keys, no .env, no test-runner variables. */
const buildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key === "NODE_ENV" || key === "TEST") delete env[key];
  }
  for (const key of [...PROVIDER_SECRETS, "CLOUDFLARE_ENV", "CLOUDFLARE_INCLUDE_PROCESS_ENV"]) delete env[key];
  return env;
};

/** Same scrubbing for this process, where wrangler resolves the Worker's vars and secrets. */
const scrubProcessEnv = () => {
  process.env["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV"] = "false";
  for (const key of [...PROVIDER_SECRETS, "CLOUDFLARE_ENV", "CLOUDFLARE_INCLUDE_PROCESS_ENV"]) delete process.env[key];
};

/** Refuses (and records) requests to OpenRouter/Autumn; returns the restore function. */
const guardOutboundFetch = (refused: Array<string>) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (FORBIDDEN_HOST.test(url.hostname)) {
      refused.push(url.href);
      return Promise.reject(new Error(`e2e: refused a request to ${url.origin}`));
    }
    return realFetch(input, init);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
};

export const startJevboard = async (): Promise<Jevboard> => {
  scrubProcessEnv();
  await promisify(execFile)(join(ROOT, "node_modules/.bin/react-router"), ["build"], {
    cwd: ROOT,
    env: buildEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });

  const dir = mkdtempSync(join(tmpdir(), "jevboard-e2e-"));
  cpSync(join(ROOT, "build"), join(dir, "build"), { recursive: true, filter: (source) => basename(source) !== ".dev.vars" });
  const configPath = join(dir, "build/server/wrangler.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    d1_databases: Array<{ migrations_dir?: string }>;
    vars?: Record<string, unknown>;
  };
  for (const database of config.d1_databases) database.migrations_dir = join(ROOT, "migrations");
  // The deployed PUBLIC_URL would send redirects and share links to production; without
  // it the app uses the request's own origin, i.e. this harness.
  delete config.vars?.["PUBLIC_URL"];
  writeFileSync(configPath, JSON.stringify(config));

  const forbiddenCalls: Array<string> = [];
  const restoreFetch = guardOutboundFetch(forbiddenCalls);
  const server = createTestHarness({
    root: dir,
    workers: [{ configPath, vars: { JEV_ALLOW_FAKE_PAYMENTS: "true", JEV_ALLOW_MOCK_JUDGE: "true" } }],
  });

  const close = async () => {
    await server.close().catch(() => undefined);
    restoreFetch();
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    const { url } = await server.listen();
    const worker = server.getWorker<{ readonly DB: D1Database } & Record<string, unknown>>();
    await worker.applyD1Migrations("DB");
    const env = await worker.getEnv();

    const leaked = PROVIDER_SECRETS.filter((name) => name in env);
    if (leaked.length > 0) throw new Error(`Refusing to run e2e tests: ${leaked.join(", ")} reached the Worker.`);

    const home = await fetch(new URL("/", url));
    const html = (await home.text()).replaceAll("<!-- -->", "");
    if (!html.includes("payments are simulated") || !html.includes("Jev is a deterministic mock")) {
      throw new Error(`Refusing to run e2e tests: the simulated-mode banner is missing (GET / → ${home.status}).`);
    }

    const recentLogs = (count = 30) =>
      server
        .getLogs()
        .slice(-count)
        .map((log) => `[${log.level}] ${log.message}`)
        .join("\n");

    return {
      baseUrl: new URL(url.origin),
      scheduled: () => worker.scheduled({ cron: "* * * * *" }),
      order: (orderId) =>
        env.DB.prepare(
          "SELECT status, kind, paid_at AS paidAt, judgment_id AS judgmentId FROM orders WHERE id = ?",
        )
          .bind(orderId)
          .first<OrderRow>(),
      simulatorPaid: async (orderId) =>
        (await env.DB.prepare("SELECT 1 AS paid FROM fake_payments WHERE order_id = ?").bind(orderId).first()) !== null,
      entry: (siteKey) =>
        env.DB.prepare("SELECT score, rolls FROM entries WHERE site_key = ?")
          .bind(siteKey)
          .first<{ score: number; rolls: number }>(),
      views: async (siteKey) =>
        (await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS views FROM views WHERE site_key = ?")
          .bind(siteKey)
          .first<number>("views")) ?? 0,
      forbiddenCalls,
      recentLogs,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

/** Polls `probe` until it returns something other than undefined/false. */
export const waitFor = async <A>(
  what: string,
  probe: () => Promise<A | undefined | false>,
  { timeoutMs = 60_000, intervalMs = 500 } = {},
): Promise<A> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
