import type { D1Database, Queue, RateLimit } from "@cloudflare/workers-types";
import { Context } from "effect";

/** Body of every message on the judgment / placement queues. */
export interface JudgmentJob {
  readonly orderId: string;
}

/** Worker bindings declared in wrangler.jsonc (plus string vars and secrets). */
export interface Env {
  readonly DB: D1Database;
  readonly JUDGMENT_QUEUE: Queue<JudgmentJob>;
  readonly PLACEMENT_QUEUE: Queue<JudgmentJob>;
  readonly VISITOR_LIMITER?: RateLimit;
  readonly IP_LIMITER?: RateLimit;
  readonly [variable: string]: unknown;
}

/** The Worker's `env`, as an Effect service so layers can depend on bindings. */
export class CloudflareEnv extends Context.Service<CloudflareEnv, Env>()("jevboard/cloudflare/Env") {}
