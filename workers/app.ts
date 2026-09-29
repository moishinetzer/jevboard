import type { ExecutionContext, MessageBatch, ScheduledController } from "@cloudflare/workers-types";
import { createRequestHandler, RouterContextProvider } from "react-router";
import type { Env, JudgmentJob } from "../app/.server/cloudflare/env";
import { handleQueueBatch } from "../app/.server/cloudflare/jobs";
import { runMaintenance } from "../app/.server/flows/maintenance";
import { runtime } from "../app/.server/runtime";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * The Jevboard Worker:
 * - fetch: React Router (loaders/actions run Effect programs on the shared runtime)
 * - queue: paid judgments (crawl + verdict) and serialized placements
 * - scheduled: every-minute maintenance (payment sweeper, stalled-job recovery)
 */
export default {
  fetch(request: Request, _env: Env, _ctx: ExecutionContext) {
    return requestHandler(request, new RouterContextProvider());
  },

  async queue(batch: MessageBatch<JudgmentJob>, _env: Env, _ctx: ExecutionContext) {
    await runtime.runPromise(handleQueueBatch(batch));
  },

  scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runtime.runPromise(runMaintenance));
  },
};
