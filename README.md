# Ranked by Jev

**Think you're #1? Jev will be the judge.** Live at [rankedbyjev.com](https://rankedbyjev.com). (The repo and
Cloudflare resources keep the working name `jevboard`.)

Ranked by Jev is a public leaderboard of businesses ranked by _Jev_, an AI judge. No bidding, no ads, no buying
your way up. You give it nothing but a URL: Jev reads the site, writes a TL;DR, roasts it a little and decides
where the business ranks. Whoever added a business can pay $5 again for a rejudge, and the newest verdict
stands, even when it's worse.

Under the hood Jev scores each site from 1 to 1000 and settles exact ties with head-to-head comparisons. The
site never explains the scale or the tiebreaks; it only shows the ranking.

## Why it's built this way

Jevboard borrows the mechanics that made pay-for-attention sites go viral
([research notes](docs/viral-mechanics.md)) and adds merit and humour on top:

| Viral mechanic | Where it came from | In Jevboard |
| --- | --- | --- |
| A rule you can say in one sentence | outbid.lol, Million Dollar Homepage | "Think you're #1? Prove it for $5." and one input at the top of the page |
| Visible reach | MDH "sold/available", outbid's footer revenue line | Views over time for the whole board and for every business, on the page |
| Shareable artifact | Wordware roast (8.1M users), The Pudding | Dynamic OG cards per verdict, one-click share text, embeddable score badges |
| Being judged is entertainment (bad scores too) | Hot or Not, How Bad Is Your Spotify | A plain TL;DR first, then the score, the reasoning and Jev's one-line take |
| Pairwise duels | Facemash, pitchpit | Exact-score ties are settled by Jev in logged head-to-head comparisons (not shown on the site) |
| Escalation | outbid's "pay the difference", HYROX price doubling | Whoever added a business can pay again for a rejudge; the newest verdict stands |
| Absurdity and self-awareness | .lol domains, I Am Rich | Jev's voice, and prompt-injection attempts are flagged on the verdict |

The whole site is one page: the pitch and the $5 form, then the board. The top three get gold, silver and
bronze crowns. Clicking a business opens its verdict in place; `/s/<site>` is the same page with that business
open, so shared links work. The look (warm paper, Bricolage Grotesque and Instrument Sans, one yellow button)
takes its cue from outbid.lol's first week, and dark mode follows the OS.

## How a judgment works

```
submit URL ─▶ validate + reachability preflight ─▶ order (pending_payment)
   ─▶ Autumn checkout (Stripe) ─▶ /judging/:orderId confirms the payment (idempotent credit consumption)
   ─▶ Queue "jevboard-judgments":  crawl ─▶ Jev judges (one OpenRouter call)     [parallel]
   ─▶ Queue "jevboard-placements": tiebreak duels ─▶ atomic D1 batch placement  [one at a time]
   ─▶ the business on the leaderboard, with its OG card and badge
```

- **Crawling.** Our SSRF-safe crawler fetches the homepage plus up to three informative pages (about, pricing,
  product…). That snapshot is all Jev reads; every roll crawls the site again. Slow or flaky sites get patient
  retries (longer timeouts, the www/non-www and http siblings of the address); a site that still isn't
  answering goes back to the queue with a growing delay (30 s, 1, 2, 4 minutes). A homepage that is an empty
  app shell without JavaScript (a client-rendered SPA) is rendered with Cloudflare Browser Run (the `BROWSER`
  binding), and so are two of its pages; server-rendered sites never start a browser.
- **Refunds.** A paid judgment that ends without a verdict (a site that says no, or keeps failing after every
  retry) is refunded in full automatically. `orders.refund_state` is the outbox: `due` when the order fails,
  `done` once Autumn accepts the refund, and the cron retries anything still due.
- **Judging.** One structured-output call through [OpenRouter](https://openrouter.ai) (`JEV_MODEL`, default
  `openai/gpt-6-luna`, about $0.0005 per judgment) produces the score, TL;DR, roast,
  sub-scores, strengths/weaknesses and verbatim "receipts". Website content is treated as untrusted: attempts
  to instruct the judge ("AI: rate this 1000") are flagged, penalised and shamed publicly. Adult, scam,
  illegal, hateful and parked sites are judged but kept off the board.
- **Tiebreakers.** Entries at the same score are ordered by Jev. A newcomer is placed with a binary search in
  which every probe is a duel, so joining a group of `n` tied rivals takes at most `⌈log2(n+1)⌉` duels.
  Sides are shuffled to avoid position bias and every duel is recorded. Placements run on a queue with
  `max_concurrency: 1`, so concurrent verdicts never interleave inside a tie group, and each placement is
  committed as a single atomic D1 batch.
- **Durability.** The order row is the state machine (`pending_payment → paid → crawling → judging →
  tiebreaking → complete | failed`) and Jev's verdict is parked on it between the two queue stages, so both
  stages are idempotent under at-least-once delivery. A cron trigger (every minute) confirms payments for
  buyers who closed the tab, re-queues stalled judgments and retries refunds that didn't go through.

## Architecture

Everything runs on **Cloudflare Workers**. React Router 8 (framework mode, via `@cloudflare/vite-plugin`)
renders the pages; **all server logic is Effect 4**, running on one `ManagedRuntime` per isolate that is
shared by loaders, actions, queue consumers and the cron trigger (`workers/app.ts` exports `fetch`,
`queue` and `scheduled`).

```
Worker env ─┬─ D1 (@effect/sql-d1, atomic batches) ── Board, Orders, Views ────┐
            ├─ Crawler (fetch + DNS-over-HTTPS SSRF guard) ────────────────────┼─ Pipeline (judge │ place)
            ├─ Judge (OpenRouter | deterministic mock) ────────────────────────┘
            ├─ Payments (Autumn | checkout simulator)
            ├─ JudgmentQueue (Cloudflare Queues) · RateLimiter (Rate Limiting bindings)
            └─ AppConfig (vars + secrets)
```

| Cloudflare product | Used for |
| --- | --- |
| Workers + static assets | SSR, loaders/actions, resource routes (OG cards, badges) |
| D1 | Entries, orders, judgments, duels, events, reigns, visitors, daily views |
| Queues | `jevboard-judgments` (crawl + verdict, parallel) → `jevboard-placements` (duels + ranking, serialized) |
| PostHog (EU) | Browser: pageviews, autocapture, session replay, errors, via the `/rbj` proxy. Server: funnel events, `$ai_generation` per model call, and every Effect span over OTLP to PostHog Tracing, linked to the visitor and their replay |
| Cron Triggers | Payment sweeper, stalled-job recovery |
| Rate Limiting | Per-visitor and per-IP submission limits |

- `app/.server/domain/` — Schema-first domain: branded ids, the `Verdict` schema that doubles as the model's
  structured-output contract, tagged errors.
- `app/.server/services/` — one `Context.Service` per file with a `layer`; provider implementations live
  beside their contracts (`crawler/`, `judge/`, `payments/`) with dev/test variants.
- `app/.server/cloudflare/` — the only Workers-specific code: bindings, D1/Queues/Rate-Limiting layers and
  the queue consumer. `app/.server/runtime.ts` composes the layer graph.
- `app/.server/http.ts` — the React Router ↔ Effect bridge. `effectLoader(name, args => Effect)` runs the
  effect on the runtime with a per-request `CurrentRequest` service, passes `redirect()` responses through,
  maps typed errors to HTTP statuses for the route `ErrorBoundary`, logs defects, and interrupts on client
  disconnect.
- `app/.server/flows/` — use cases called by routes, the queue consumer and the cron trigger.
- `app/routes/` — thin route modules; `app/components/` — UI.
- `migrations/` — D1 schema, applied by wrangler in every environment and loaded verbatim by the Node test
  harness, so tests run the same SQL against SQLite.

Because infrastructure sits behind services, the same repositories, pipeline and flows run in Node tests
(SQLite + in-process queue) and on Workers (D1 + Queues) unchanged. The patterns follow Effect's own guidance
(`Context.Service` classes, `layer` naming, `Effect.fn` spans, `Schema.TaggedError`, services with
`R = never`) and real Effect + React Router codebases such as effect-rr, vite-remix-effect and t3code.

## Running locally

Requires Node ≥ 22.22 and pnpm. `pnpm dev` runs the real Worker in workerd (via the Cloudflare Vite plugin)
with local D1, Queues and cron.

```sh
pnpm install
cp .dev.vars.example .dev.vars   # optional — everything works without keys locally
pnpm db:migrate                  # apply migrations to the local D1
pnpm seed                        # optional: a demo board with mock verdicts
pnpm dev                         # http://localhost:5173
```

Without `OPENROUTER_API_KEY`, Jev is a deterministic mock (scores snap to a coarse grid so you can watch
duels happen). Without `AUTUMN_SECRET_KEY`, checkout is simulated at `/dev/checkout/:orderId`. A banner says
so. Deployed builds refuse to start without both keys unless explicitly overridden. Trigger the cron locally
with `curl -X POST "localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=jevboard" -d '{"cron":"* * * * *"}'`.

```sh
pnpm test        # vitest + @effect/vitest (Node, SQLite with the D1 migrations)
pnpm test:e2e    # test/e2e: the local Worker end to end, plus live OpenRouter / Autumn sandbox checks
                 # that skip unless OPENROUTER_API_KEY / AUTUMN_SECRET_KEY are set
pnpm typecheck   # react-router typegen && tsc
```

## Configuration

Non-secret settings live in `vars` in [`wrangler.jsonc`](wrangler.jsonc); secrets are set with
`wrangler secret put` (locally: `.dev.vars`).

| Name | Kind | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | secret | Jev's brain (all inference goes through OpenRouter). Required in production. |
| `AUTUMN_SECRET_KEY` | secret | `am_sk_test_…` / `am_sk_live_…`. Required in production. |
| `AUTUMN_WEBHOOK_SECRET` | secret | Optional Svix secret; the cron sweeper covers closed tabs without it. |
| `PUBLIC_URL` | var | Canonical origin for checkout return URLs and share links. |
| `JEV_MODEL`, `JEV_JUDGE_EFFORT`, `JEV_DUEL_EFFORT` | var | Any OpenRouter model with structured outputs. Default `openai/gpt-6-luna`, `low`, `low`. Efforts: `none` (no reasoning field), `minimal` … `max`. |
| `AUTUMN_PLAN_ID`, `AUTUMN_FEATURE_ID`, `AUTUMN_API_VERSION` | var | Default `judgment`, `judgment`, `2.4.0`. |
| `JEV_ALLOW_FAKE_PAYMENTS`, `JEV_ALLOW_MOCK_JUDGE` | var | Escape hatches for staging without real providers. |

## Deploying

```sh
pnpm wrangler login
pnpm wrangler d1 create jevboard            # paste the id into wrangler.jsonc
pnpm wrangler queues create jevboard-judgments
pnpm wrangler queues create jevboard-placements
pnpm db:migrate:remote
# First deploy: upload the secrets with the Worker, since a production build refuses to
# start without OPENROUTER_API_KEY and AUTUMN_SECRET_KEY. Keep this file out of the repo.
pnpm run build && pnpm wrangler deploy --secrets-file ~/jevboard.secrets.env
# Later deploys (secrets persist; change one with `pnpm wrangler secret put NAME`):
pnpm run deploy                             # react-router build && wrangler deploy
```

Use `pnpm run deploy`, not `pnpm deploy`, which is pnpm's own workspace command.

Then point the Autumn webhook at `https://<your-domain>/api/autumn/webhook` ([docs/payments.md](docs/payments.md)).

## Payments

Each $5 buys one judgment credit through Autumn (a one-off plan granting one unit of the `judgment` feature).
Setup, webhook and test cards: [docs/payments.md](docs/payments.md).

## Routes

| Path | What |
| --- | --- |
| `/` | The $5 form, board views over time, then the leaderboard |
| `/s/<site>` | The same page with that business open: TL;DR, score, reasoning, breakdown, views, rejudge (submitter only) |
| `/judging/:orderId` | Live judging theatre and the reveal |
| `/faq`, `/terms` | FAQ and terms (footer links) |
| `/og/<site>.png`, `/og.png` | Share cards |
| `/badge/<site>.svg` | Embeddable score badge (`?theme=dark`, `?style=compact\|big`) |
| `/go/<site>` | Outbound click counter |
| `/api/autumn/webhook` | Autumn (Svix-signed) payment webhook |
