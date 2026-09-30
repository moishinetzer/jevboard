import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Browser, textOf, titleOf, type Visit } from "./support/browser";
import { type Jevboard, startJevboard, waitFor } from "./support/jevboard";

/**
 * The built Worker in workerd, driven over HTTP like a browser would (see
 * support/jevboard.ts for how it's booted and why it can't reach real providers).
 * Payments go through the checkout simulator, verdicts come from mock Jev, and the
 * crawler fetches the (real, stable) sites below. Tests run in order and share the board.
 */
const SITE = "example.com"; // first judgment, then a reroll
const CANCELLED_SITE = "example.net"; // checkout cancelled, never judged
const CLOSED_TAB_SITE = "example.org"; // paid, tab closed, confirmed by the cron

let jev: Jevboard;
/** The visitor who paid for SITE: only they get its "Rejudge" button. */
let submitter: Browser;

beforeAll(async () => {
  jev = await startJevboard();
});

afterAll(async () => {
  await jev?.close();
});

beforeEach(({ onTestFailed }) => {
  onTestFailed(() => console.error(`Recent Worker logs:\n${jev?.recentLogs()}`));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh visitor who has landed on the home page (and so holds a jev_vid cookie). */
const newVisitor = async () => {
  const browser = new Browser(jev.baseUrl);
  const home = await browser.get("/");
  expect(home.status).toBe(200);
  expect(browser.visitorId).toMatch(/^c\w{22}$/);
  return browser;
};

/** Submits the $5 form and follows the redirect to the checkout simulator. */
const submitForCheckout = async (browser: Browser, fields: { readonly url: string }) => {
  const checkout = await browser.submit("/judge", fields);
  // A failed preflight (e.g. no network) answers 400 with the reason in the body.
  expect(checkout.redirects[0], `POST /judge → ${checkout.status} ${checkout.html.slice(0, 200)}`).toMatch(
    /^\/dev\/checkout\/\w+\?return=/,
  );
  expect(checkout.status).toBe(200);
  expect(textOf(checkout.html)).toContain("Simulated checkout");
  const orderId = /^\/dev\/checkout\/(\w+)\?/.exec(checkout.path)?.[1] ?? "";
  return { checkout, orderId };
};

/** Polls the judging page, as the page itself does, until the case closes. */
const waitForVerdict = (browser: Browser, orderId: string) =>
  waitFor(`order ${orderId} to be judged`, async () => {
    const page = await browser.get(`/judging/${orderId}`);
    expect(page.status).toBe(200);
    const title = titleOf(page.html);
    if (title.includes("no verdict")) throw new Error(`No verdict for ${orderId}: ${textOf(page.html).slice(0, 500)}`);
    return title.includes("Jev has spoken") ? page : undefined;
  });

/**
 * /s/<site> is the board with that business opened in place: its rank in the
 * title, the details section rendered with its score, and its roll count from D1.
 */
const verdictOf = async (page: Visit, site: string) => {
  const rank = /: #(\d+) on Ranked by Jev$/.exec(titleOf(page.html));
  expect(rank, `verdict page title: ${titleOf(page.html)}`).not.toBeNull();
  expect(page.html).toContain('aria-expanded="true"');
  expect(textOf(page.html)).toContain(`Why Jev put it at #${rank?.[1]}`);
  const entry = await jev.entry(site);
  expect(entry, `${site} on the board`).not.toBeNull();
  expect(page.html).toContain(`>${entry?.score}<`);
  return { score: entry?.score ?? 0, rolls: entry?.rolls ?? 0 };
};

/** The hidden URL field of the one-click "Rejudge" form, if the page has one. */
const rejudgeUrlOf = (page: Visit) => /<input type="hidden" name="url" value="([^"]+)"/.exec(page.html)?.[1];

describe("Jevboard Worker (simulated payments, mock Jev)", () => {
  it("GET /healthz reports ok", async () => {
    const response = await fetch(new URL("/healthz", jev.baseUrl));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, entries: 0 });
  });

  it("happy path: submit from the home page, pay in the simulator, get judged, land on the board", async () => {
    const browser = await newVisitor();
    submitter = browser;
    const { checkout, orderId } = await submitForCheckout(browser, { url: `https://${SITE}` });
    expect(textOf(checkout.html)).toContain(SITE);
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", kind: "new", paidAt: null });

    // "Pay $5 (pretend)" posts the form back to the simulator, which sends us to the judging page.
    const judging = await browser.submit(checkout.path, {});
    expect(judging.redirects).toEqual([`/judging/${orderId}`]);
    expect(judging.status).toBe(200);

    const reveal = await waitForVerdict(browser, orderId);
    const announced = new RegExp(`Jev has spoken: ${SITE.replace(/\./g, "\\.")} is #(\\d+) of (\\d+), with (\\d+)\\.`).exec(
      textOf(reveal.html),
    );
    expect(announced, "verdict announcement on the judging page").not.toBeNull();
    expect(await jev.order(orderId)).toMatchObject({ status: "complete", kind: "new" });

    const entry = await browser.get(`/s/${SITE}`);
    expect(entry.status).toBe(200);
    const verdict = await verdictOf(entry, SITE);
    expect(verdict.score).toBe(Number(announced?.[3]));
    expect(verdict.score).toBeGreaterThanOrEqual(1);
    expect(verdict.score).toBeLessThanOrEqual(1000);
    expect(verdict.rolls).toBe(1);

    // On the home page: a board row (<li>) linking to the verdict and showing the score.
    const board = await browser.get("/");
    const rows = board.html
      .split("<li")
      .slice(1)
      .map((chunk) => textOf(chunk.split("</li>")[0] ?? ""))
      .filter((row) => row.includes(`href="/s/${SITE}"`));
    expect(rows.length, "board rows linking to the verdict").toBeGreaterThan(0);
    expect(rows.some((row) => row.includes(`>${verdict.score}<`))).toBe(true);
  });

  it("only the submitter sees the Rejudge button on their business", async () => {
    const stranger = await newVisitor();
    const seen = await stranger.get(`/s/${SITE}`);
    await verdictOf(seen, SITE);
    expect(rejudgeUrlOf(seen)).toBeUndefined();
    expect(seen.html).not.toContain(">Rejudge · $5<");

    expect(rejudgeUrlOf(await submitter.get(`/s/${SITE}`))).toBe(`https://${SITE}/`);
  });

  it("reroll: the submitter's Rejudge button adds a roll", async () => {
    const browser = submitter;
    const entry = await browser.get(`/s/${SITE}`);
    const before = await verdictOf(entry, SITE);

    // "Rejudge · $5" posts the site's URL from a hidden field.
    const siteUrl = rejudgeUrlOf(entry);
    expect(siteUrl).toBe(`https://${SITE}/`);
    const { checkout, orderId } = await submitForCheckout(browser, { url: siteUrl ?? "" });
    expect(textOf(checkout.html)).toContain("Rejudge");
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", kind: "reroll" });

    const judging = await browser.submit(checkout.path, {});
    expect(judging.path).toBe(`/judging/${orderId}`);
    await waitForVerdict(browser, orderId);

    const after = await verdictOf(await browser.get(`/s/${SITE}`), SITE);
    expect(after.rolls).toBe(before.rolls + 1);
  });

  it("cancelled checkout: the order stays unpaid and is never judged", async () => {
    const browser = await newVisitor();
    const { checkout, orderId } = await submitForCheckout(browser, { url: CANCELLED_SITE });

    // "Cancel and go back" on the simulator (Autumn's cancel_url is the same page).
    const cancelHref = /href="(\/\?cancelled=[^"]+)"/.exec(checkout.html)?.[1];
    expect(cancelHref).toBe(`/?cancelled=${orderId}`);
    const home = await browser.get(cancelHref ?? "/");
    expect(home.status).toBe(200);
    expect(textOf(home.html)).toContain(`Checkout cancelled for ${CANCELLED_SITE}.`);
    // Anyone else opening the same link isn't told which site it was.
    const stranger = await (await newVisitor()).get(cancelHref ?? "/");
    expect(textOf(stranger.html)).toContain("Checkout cancelled.");
    expect(textOf(stranger.html)).not.toContain(`Checkout cancelled for ${CANCELLED_SITE}`);

    // The payment sweeper looks at unpaid orders too; it must not find a payment.
    expect((await jev.scheduled()).outcome).toBe("ok");
    await sleep(3_000); // longer than a queued mock judgment would need to start
    expect(await jev.simulatorPaid(orderId)).toBe(false);
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", paidAt: null, judgmentId: null });

    // Coming back to the judging page still shows the payment desk, not a verdict.
    const judging = await browser.get(`/judging/${orderId}`);
    expect(textOf(judging.html)).toContain("Waiting for your $5");
    expect((await browser.get(`/s/${CANCELLED_SITE}`)).status).toBe(404);
  });

  it("closed tab: a simulated payment nobody came back for is confirmed by the cron and judged", async () => {
    const browser = await newVisitor();
    const { checkout, orderId } = await submitForCheckout(browser, { url: CLOSED_TAB_SITE });

    // Pay, but close the tab instead of following the redirect to /judging/<orderId>.
    const paid = await browser.submit(checkout.path, {}, { follow: false });
    expect(paid.status).toBe(302);
    expect(paid.redirects).toEqual([`/judging/${orderId}`]);

    // The simulator only records the payment (fake_payments); confirming it is the job of
    // the judging page, the webhook (off here) or the cron sweeper. So far nobody has.
    expect(await jev.simulatorPaid(orderId)).toBe(true);
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", paidAt: null });

    expect((await jev.scheduled()).outcome).toBe("ok");
    const order = await waitFor(`order ${orderId} to be judged after the cron`, async () => {
      const row = await jev.order(orderId);
      if (row?.status === "failed") throw new Error(`order ${orderId} failed`);
      return row?.status === "complete" ? row : undefined;
    });
    expect(order.paidAt).not.toBeNull();
    expect(order.judgmentId).not.toBeNull();

    const entry = await browser.get(`/s/${CLOSED_TAB_SITE}`);
    expect(entry.status).toBe(200);
    expect((await verdictOf(entry, CLOSED_TAB_SITE)).rolls).toBe(1);
  });

  it("public assets: OG card, score badge and sitemap", async () => {
    const browser = new Browser(jev.baseUrl);
    const { score } = await verdictOf(await browser.get(`/s/${SITE}`), SITE);

    const og = await fetch(new URL(`/og/${SITE}.png`, jev.baseUrl));
    expect(og.status).toBe(200);
    expect(og.headers.get("Content-Type")).toBe("image/png");
    const png = new Uint8Array(await og.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const badge = await fetch(new URL(`/badge/${SITE}.svg`, jev.baseUrl));
    expect(badge.status).toBe(200);
    expect(badge.headers.get("Content-Type")).toMatch(/^image\/svg\+xml/);
    const svg = await badge.text();
    expect(svg.trimStart()).toMatch(/^<svg\b/);
    expect(svg).toContain(`· ${score}<`);
    expect(svg).not.toContain("/1000");

    const sitemap = await fetch(new URL("/sitemap.xml", jev.baseUrl));
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("Content-Type")).toMatch(/^application\/xml/);
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${jev.baseUrl.origin}/s/${SITE}</loc>`);
    expect(xml).toContain(`<loc>${jev.baseUrl.origin}/s/${CLOSED_TAB_SITE}</loc>`);
    expect(xml).not.toContain(`/s/${CANCELLED_SITE}<`);
  });

  it("counts a view of the board and of the business when a person opens it, but not for bots", async () => {
    const person = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      "Sec-Fetch-Dest": "document",
    };
    const site = await jev.views(CLOSED_TAB_SITE);
    const board = await jev.views("");

    const page = await fetch(new URL(`/s/${CLOSED_TAB_SITE}`, jev.baseUrl), { headers: person });
    expect(page.status).toBe(200);
    expect(textOf(await page.text())).toContain("in the last 30 days");
    expect(await jev.views(CLOSED_TAB_SITE)).toBe(site + 1);
    expect(await jev.views("")).toBe(board + 1);

    // Crawlers and scripts (Node's fetch says "node") don't count.
    for (const agent of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "node"]) {
      const bot = await fetch(new URL(`/s/${CLOSED_TAB_SITE}`, jev.baseUrl), { headers: { "User-Agent": agent } });
      expect(bot.status).toBe(200);
    }
    expect(await jev.views(CLOSED_TAB_SITE)).toBe(site + 1);
  });

  it("POST /api/autumn/webhook is a 404 without AUTUMN_WEBHOOK_SECRET", async () => {
    const response = await fetch(new URL("/api/autumn/webhook", jev.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_e2e",
        "svix-timestamp": `${Math.floor(Date.now() / 1000)}`,
        "svix-signature": "v1,AAAA",
      },
      body: JSON.stringify({ type: "billing.updated", data: { customer_id: "jev_e2e", plan_changes: [] } }),
    });
    expect(response.status).toBe(404);
  });

  it("rate limit: the 11th submission from one visitor within a minute is refused", async () => {
    const browser = await newVisitor();
    // Local rate-limit windows are aligned to wall-clock minutes: don't straddle one.
    const untilNextMinute = 60_000 - (Date.now() % 60_000);
    if (untilNextMinute < 5_000) await sleep(untilNextMinute + 250);

    // Empty URLs are counted (the limiter runs first) but never reach the network.
    for (let attempt = 1; attempt <= 10; attempt++) {
      const visit = await browser.submit("/judge", { url: "" });
      expect(visit.status).toBe(400);
      expect(JSON.parse(visit.html)).toMatchObject({ ok: false, field: "url" });
    }
    const limited = await browser.submit("/judge", { url: "" });
    expect(limited.status).toBe(400);
    expect(JSON.parse(limited.html)).toMatchObject({ ok: false, field: "rate", message: expect.stringMatching(/Easy there/) });
  });

  it("never contacted OpenRouter or Autumn", () => {
    expect(jev.forbiddenCalls).toEqual([]);
  });
});
