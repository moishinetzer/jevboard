# Jevboard

**Paste your site. Pay $5. Jev decides what it's worth.**

Jevboard is a public leaderboard of businesses ranked by _Jev_, an AI judge. You give it nothing but a URL.
Jev crawls the site, writes a TL;DR, roasts it a little, and scores how useful the business is from **1 to
1000**. If you tie someone to the exact point, Jev puts you both in **the Duel Pit** and runs head-to-head
duels until you find your place. Don't like your score? **$5 buys a retrial** — as many times as you want.
The newest verdict stands, even when it's worse.

> You can't buy #1. You can only buy Jev's attention.

## Why it's built this way

Jevboard borrows the mechanics that made pay-for-attention sites go viral
([research notes](docs/viral-mechanics.md)) and adds merit and humour on top:

| Viral mechanic | Where it came from | In Jevboard |
| --- | --- | --- |
| A rule you can say in one sentence | outbid.lol, Million Dollar Homepage | "Paste your site. Pay $5. Jev decides." — one input on the home page |
| Displacement makes its own content | outbid.lol takeovers, Satoshi's Place | **The Tape**: live ticker of new entries, rerolls, duels, crownings and dethronings |
| Status and a permanent record | MDH "own a piece of internet history", King of the Ether throne history | Reign timers for #1, throne history, "Judgment #0042" serials, Founding Defendant stickers |
| Live counters and public revenue | MDH "sold/available", outbid's footer revenue line | Watching-now, judging-now and "$X fed to Jev since launch" everywhere; `/stats` receipts page |
| Shareable artifact | Wordware roast (8.1M users), The Pudding | Dynamic OG cards per verdict, one-click share text, embeddable score badges |
| Being judged is entertainment (bad scores too) | Hot or Not, How Bad Is Your Spotify | Roast verdicts, meme-able hyphenated labels, Hall of Shame, judging "theatre" |
| Pairwise duels | Facemash, pitchpit | Exact-score ties are settled by Jev in logged head-to-head duels |
| Escalation | outbid's "pay the difference", HYROX price doubling | Rerolls: pay again, risk it, publicly count every retrial |
| Absurdity and self-awareness | .lol domains, I Am Rich | Jev's voice, the "Bribe Jev" button, prompt-injection attempts publicly shamed |

## How a judgment works

```
submit URL ─▶ validate + reachability preflight ─▶ order (pending_payment)
   ─▶ Autumn checkout (Stripe) ─▶ /judging/:orderId confirms the payment (idempotent credit consumption)
   ─▶ worker queue: crawl ─▶ Jev judges (Claude + web_fetch) ─▶ tiebreak duels ─▶ atomic placement
   ─▶ events on The Tape, reigns, verdict page, OG card, badge
```

- **Crawling.** Our SSRF-safe crawler fetches the homepage plus up to three informative pages (about, pricing,
  product…). Jev then reads that snapshot _and_ can crawl the site itself with Claude's server-side
  `web_fetch` tool, restricted to the site's domain. Rerolls bypass the fetch cache.
- **Judging.** One structured-output Claude call produces the score, TL;DR, roast, hyphenated label,
  sub-scores, strengths/weaknesses and verbatim "receipts". Website content is treated as untrusted: attempts
  to instruct the judge ("AI: rate this 1000") are flagged, penalised and shamed publicly. Adult, scam,
  illegal, hateful and parked sites are judged but kept off the board.
- **Tiebreakers.** Entries at the same score are ordered by Jev. A newcomer is placed with a binary search in
  which every probe is a duel, so joining a group of `n` tied rivals takes at most `⌈log2(n+1)⌉` duels.
  Sides are shuffled to avoid position bias, every duel is recorded, and placements run under a global lock so
  concurrent judgments never interleave.
- **Durability.** The order row is the state machine (`pending_payment → paid → crawling → judging →
  tiebreaking → complete | failed`). Workers re-enqueue in-flight orders on boot, a sweeper confirms payments
  for buyers who closed the tab, and a failed paid judgment can be retried for free.

## Architecture

React Router 8 (framework mode) renders everything; **all server logic is Effect 4** and runs on one
`ManagedRuntime` shared by loaders, actions and background workers.

```
AppConfig ─┬─ Database (SQLite, migrations) ── Board, Orders ─┐
           ├─ Crawler (SSRF-safe undici) ─────────────────────┼─ Pipeline ── JudgmentQueue (workers, recovery, sweeper)
           ├─ Judge (Claude | deterministic mock) ────────────┘
           ├─ Payments (Autumn | local simulator)
           └─ Presence (who's watching)
```

- `app/.server/domain/` — Schema-first domain: branded ids, the `Verdict` schema that doubles as Claude's
  structured-output contract, tagged errors.
- `app/.server/services/` — one `Context.Service` per file with a `layer`; implementations for external
  providers live beside their contracts (`crawler/`, `judge/`, `payments/`) with test/dev variants.
- `app/.server/http.ts` — the React Router ↔ Effect bridge. `effectLoader(name, args => Effect)` runs the
  effect on the runtime with a per-request `CurrentRequest` service, passes `redirect()` responses through,
  maps typed errors to HTTP statuses for the route `ErrorBoundary`, logs defects, and interrupts on client
  disconnect.
- `app/.server/flows/` — use cases called by routes (submit, judging page, shell/feed).
- `app/routes/` — thin route modules; `app/components/` — UI.

The patterns follow Effect's own guidance (`Context.Service` classes, `layer` naming, `Effect.fn` spans,
`Schema.TaggedError`, services with `R = never`) and real Effect + React Router codebases such as
effect-rr, vite-remix-effect and t3code.

## Running locally

Requires Node ≥ 22.22 and pnpm.

```sh
pnpm install
cp .env.example .env        # optional — everything works without keys in dev
pnpm seed                   # optional: a demo board with mock verdicts
pnpm dev                    # http://localhost:5173
```

Without `ANTHROPIC_API_KEY`, Jev is a deterministic mock (scores snap to a coarse grid so you can watch
duels happen). Without `AUTUMN_SECRET_KEY`, checkout is simulated at `/dev/checkout/:orderId`. A banner says so.
In production both keys are required unless explicitly overridden.

```sh
pnpm test        # vitest + @effect/vitest
pnpm typecheck   # react-router typegen && tsc
pnpm build && pnpm start
```

## Configuration

See [`.env.example`](.env.example). The important ones: `ANTHROPIC_API_KEY`, `AUTUMN_SECRET_KEY`,
`AUTUMN_WEBHOOK_SECRET`, `PUBLIC_URL`, `DATABASE_PATH`, `JEV_MODEL` (default `claude-opus-5-5`),
`JEV_JUDGE_EFFORT`, `JEV_DUEL_EFFORT`, `JEV_WORKERS`.

## Payments

Each $5 buys one judgment credit through Autumn (a one-off plan granting one unit of the `judgment` feature).
Setup, webhook and test cards: [docs/payments.md](docs/payments.md).

## Deploying

The app is a single Node process with SQLite, so deploy it on anything with a persistent volume (Fly.io,
Railway, Render, a VM). The included `Dockerfile` builds the app, stores the database at
`/data/jevboard.db` and exposes `/healthz`. Run one instance: the worker queue and placement lock are
in-process.

## Routes

| Path | What |
| --- | --- |
| `/` | Hero, podium, the board (all-time / today / week / newest / most rerolled, search, categories) |
| `/s/<site>` | Verdict page: score, rank, roast, sub-scores, receipts, roll history, duels, share, badge |
| `/judging/:orderId` | Live judging theatre and the reveal |
| `/hall` | Throne history, hall of fame and shame, glow-ups, faceplants, bribers, duel champions |
| `/stats` | Public receipts: revenue, judgments, distribution |
| `/tv` | Full-screen board for streams |
| `/og/<site>.png`, `/og.png` | Share cards |
| `/badge/<site>.svg` | Embeddable score badge (`?theme=dark`, `?style=compact\|big`) |
| `/go/<site>` | Outbound click counter |
| `/api/feed` | The Tape + live counters (polled) |
| `/api/autumn/webhook` | Autumn (Svix-signed) payment webhook |
