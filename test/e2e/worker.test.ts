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
    if (title.includes("mistrial")) throw new Error(`Mistrial for ${orderId}: ${textOf(page.html).slice(0, 500)}`);
    return title.includes("Jev has spoken") ? page : undefined;
  });

/** Score and roll count from a verdict page (/s/<site>). */
const verdictOf = (page: Visit, site: string) => {
  const score = /^(\S+) — (\d+)\/1000 on Jevboard$/.exec(titleOf(page.html));
  expect(score?.[1], `verdict page title: ${titleOf(page.html)}`).toBe(site);
  const rolls = /\b(\d+) rolls? · /.exec(textOf(page.html));
  expect(rolls, "roll count on the verdict page").not.toBeNull();
  return { score: Number(score?.[2]), rolls: Number(rolls?.[1]) };
};

describe("Jevboard Worker (simulated payments, mock Jev)", () => {
  it("GET /healthz reports ok", async () => {
    const response = await fetch(new URL("/healthz", jev.baseUrl));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, entries: 0 });
  });

  it("happy path: submit from the home page, pay in the simulator, get judged, land on the board", async () => {
    const browser = await newVisitor();
    const { checkout, orderId } = await submitForCheckout(browser, { url: `https://${SITE}` });
    expect(textOf(checkout.html)).toContain(SITE);
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", kind: "new", paidAt: null });

    // "Pay $5 (pretend)" posts the form back to the simulator, which sends us to the judging page.
    const judging = await browser.submit(checkout.path, {});
    expect(judging.redirects).toEqual([`/judging/${orderId}`]);
    expect(judging.status).toBe(200);

    const reveal = await waitForVerdict(browser, orderId);
    const announced = /Jev has spoken: (\d+) out of 1000, rank (\d+) of (\d+)\./.exec(textOf(reveal.html));
    expect(announced, "verdict announcement on the judging page").not.toBeNull();
    expect(await jev.order(orderId)).toMatchObject({ status: "complete", kind: "new" });

    const entry = await browser.get(`/s/${SITE}`);
    expect(entry.status).toBe(200);
    const verdict = verdictOf(entry, SITE);
    expect(verdict.score).toBe(Number(announced?.[1]));
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

  it("reroll: demanding a retrial from the verdict page adds a roll", async () => {
    const browser = await newVisitor();
    const entry = await browser.get(`/s/${SITE}`);
    const before = verdictOf(entry, SITE);

    // The "Demand a retrial — $5" button posts the site's URL from a hidden field.
    const siteUrl = /<input type="hidden" name="url" value="([^"]+)"/.exec(entry.html)?.[1];
    expect(siteUrl).toBe(`https://${SITE}/`);
    const { checkout, orderId } = await submitForCheckout(browser, { url: siteUrl ?? "" });
    expect(textOf(checkout.html)).toContain("Demand a retrial");
    expect(await jev.order(orderId)).toMatchObject({ status: "pending_payment", kind: "reroll" });

    const judging = await browser.submit(checkout.path, {});
    expect(judging.path).toBe(`/judging/${orderId}`);
    await waitForVerdict(browser, orderId);

    const after = verdictOf(await browser.get(`/s/${SITE}`), SITE);
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
    expect(verdictOf(entry, CLOSED_TAB_SITE).rolls).toBe(1);
  });

  it("public assets: OG card, score badge and sitemap", async () => {
    const browser = new Browser(jev.baseUrl);
    const { score } = verdictOf(await browser.get(`/s/${SITE}`), SITE);

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
    expect(svg).toContain(`${score}/1000`);

    const sitemap = await fetch(new URL("/sitemap.xml", jev.baseUrl));
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("Content-Type")).toMatch(/^application\/xml/);
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${jev.baseUrl.origin}/s/${SITE}</loc>`);
    expect(xml).toContain(`<loc>${jev.baseUrl.origin}/s/${CLOSED_TAB_SITE}</loc>`);
    expect(xml).not.toContain(`/s/${CANCELLED_SITE}<`);
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
