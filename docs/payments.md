# Payments (Autumn)

Jevboard charges $5 per judgment through [Autumn](https://useautumn.com), which runs Stripe Checkout for us.
Without `AUTUMN_SECRET_KEY` the app uses the local checkout simulator (`/dev/checkout/:orderId`) instead.

## How it works

Every order gets its own Autumn customer, `jev_<orderId>`. The buyer's anonymous visitor id and the order id
are stored in that customer's `metadata`. Orders can't share credits or cancel each other's checkout sessions.

1. **Checkout** (`POST /judge`): `customers.get_or_create`, then `billing.attach` with `redirect_mode: "always"`.
   The buyer is redirected to the returned Stripe Checkout URL. Stripe sends them back to `/judging/<orderId>`,
   and the "back" link on Checkout goes to `/?cancelled=<orderId>`.
2. **Confirmation**: `customers.get` must return **HTTP 200** and show the `judgment` balance with `granted >= 1`,
   or a purchase of the `judgment` plan. Only then is the credit consumed, with
   `balances.track` and the header `Idempotency-Key: consume:<orderId>`. A repeat of that call gets a 409, which
   counts as success. Anything unexpected (5xx, network error, odd response) is an error and never counts as paid.
   Confirmation runs in three places:
   - the judging page, when the buyer returns;
   - the webhook below;
   - the cron trigger (`scheduled`, every minute), for unpaid orders from the last 3 hours: orders younger
     than 15 minutes are checked every minute, older ones every 10 minutes.
3. **Webhook** (optional, recommended): Autumn sends `billing.updated` to `/api/autumn/webhook`. After checking
   the Svix signature, the app runs the same confirmation, so a buyer who paid and closed the tab is judged within
   seconds instead of waiting for the cron trigger. The webhook never marks anything paid on its own.

The code is in `app/.server/services/payments/` (`AutumnClient.ts`, `AutumnPayments.ts`, `webhook.ts`).

## Setup

### 1. Create the feature and the plan

Autumn needs one feature and one plan:

- **Feature `judgment`**: metered, consumable.
- **Plan `judgment`**: a one-off price of $5 that includes 1 `judgment` with no reset. Mark it as an add-on.

There are two ways to create them:

- **With the CLI** (`atmn` is a dev dependency). Put the sandbox key in a gitignored `.env` as
  `AUTUMN_SECRET_KEY` (or run `pnpm atmn login`), then run `pnpm atmn push` to preview and
  `pnpm atmn push --yes` to apply. Add `-p` to push to production, which reads `AUTUMN_PROD_SECRET_KEY`.
  The CLI reads `autumn.config.ts` and writes the created `internalId`s back into it. A push sends the whole
  catalog: plans and features in that Autumn environment that aren't in the config are deleted, so read the
  preview first.
- **In the dashboard.** Go to *Plans* → *Create plan* and set:
  - name and id: `judgment`;
  - price: **One-off**, $5;
  - feature: add `judgment` (Metered, Consumable) with a grant of 1 and no reset;
  - toggle **Add-on**.

If you use other ids, set `AUTUMN_PLAN_ID` and `AUTUMN_FEATURE_ID`.

### 2. Keys

| Variable | Value |
|---|---|
| `AUTUMN_SECRET_KEY` | `am_sk_test_…` (sandbox) or `am_sk_live_…` (production). The prefix picks the environment. Set it with `wrangler secret put` (locally: `.dev.vars`). |
| `PUBLIC_URL` | The public origin, e.g. `https://jevboard.com`. It is used to build the Stripe return URLs. |
| `AUTUMN_API_VERSION` | `2.4.0` (the default). Response shapes depend on it. |
| `AUTUMN_API_URL` | `https://api.useautumn.com/v1` (the default). |

The sandbox uses Autumn's shared Stripe test account, so it needs no Stripe setup. Production needs your own
Stripe account, connected in the Autumn dashboard under *Deploy to Production*.

### 3. Webhook

1. In the Autumn dashboard, open *Developer* → *Webhooks* and add an endpoint:
   - URL: `https://<your host>/api/autumn/webhook`
   - event: `billing.updated`

   Autumn accepts only public https URLs. For local testing, use a tunnel such as ngrok.
2. Copy the endpoint's signing secret (`whsec_…`) into **`AUTUMN_WEBHOOK_SECRET`** (`wrangler secret put AUTUMN_WEBHOOK_SECRET`).
   The secret is shown once.
3. You can also let `atmn` manage the endpoint. Push with `AUTUMN_WEBHOOK_URL=<url>` set. For the sandbox,
   `atmn` writes the new secret to `.env.local` (or `.env`) as `AUTUMN_WEBHOOK_JEVBOARD_SANDBOX_SECRET`. For
   production, set `AUTUMN_WEBHOOK_ENV=live` and push with `-p`; the secret lands in `.env.prod` as
   `AUTUMN_WEBHOOK_JEVBOARD_SECRET`. Copy it into `AUTUMN_WEBHOOK_SECRET`.

The route answers:

- **404** when `AUTUMN_WEBHOOK_SECRET` is not set;
- **400 or 401** when a signature is bad or missing, or its timestamp is more than 5 minutes off;
- **200** for every correctly signed event, including events it ignores;
- **503** when Autumn can't confirm the payment yet, so that Svix retries.

Without a webhook, payments are still picked up: by the judging page when the buyer returns, and by the
cron trigger otherwise.

### 4. Test cards (sandbox)

Use any future expiry date, any CVC and any postcode.

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Requires 3-D Secure |
| `4000 0000 0000 9995` | Declined (insufficient funds) |
| `4000 0000 0000 0002` | Declined |

## Check these in the sandbox before going live

This integration was built from Autumn's API 2.4.0 source and SDK. It has not yet been tested against a live
sandbox. On the first sandbox run, check that:

- `customers.get` before payment returns `balances: {}` or a `judgment` entry with `granted: 0`, and that after
  payment it shows `granted: 1` and a `purchases[]` entry for `judgment`;
- Autumn accepts `subscription_id` on a one-off attach, and a second attach after payment returns
  409 `duplicate_subscription_id`;
- `checkout_session_params` reaches Stripe unchanged. The keys used are `cancel_url`, `client_reference_id`,
  `payment_method_types`, `allow_promotion_codes`, `saved_payment_method_options` and
  `custom_text.submit.message`;
- the `billing.updated` payload has the form `{ type, data: { customer_id, plan_changes: [{ action: "activated" }] } }`,
  and the signing secret has the `whsec_` format;
- a repeated `balances.track` with the same `Idempotency-Key` returns 409.
