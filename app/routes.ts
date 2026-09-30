import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // The board, and the board with one business opened: /s/acme.com, /s/github.com/acme.
  // One module for both, so opening and closing a row keeps the page mounted.
  index("routes/board.tsx", { id: "home" }),
  route("s/*", "routes/board.tsx", { id: "entry" }),
  // POST-only: "Add my business · $5" / "Rejudge · $5"
  route("judge", "routes/judge.tsx"),
  route("judging/:orderId", "routes/judging.tsx"),
  route("faq", "routes/faq.tsx"),
  route("terms", "routes/terms.tsx"),
  // Local checkout simulator (only active without AUTUMN_SECRET_KEY)
  route("dev/checkout/:orderId", "routes/dev-checkout.tsx"),
  // Resource routes
  route("go/*", "routes/go.ts"),
  // Autumn (Svix-signed) payment webhook
  route("api/autumn/webhook", "routes/api.autumn-webhook.ts"),
  // Beacon: a board row was opened in the browser (counts a view)
  route("api/view", "routes/api.view.ts"),
  // The guided onboarding (test B): Jev's read of a site before checkout, and its five steps
  route("api/preview", "routes/api.preview.ts"),
  route("start", "routes/start.tsx"),
  route("og.png", "routes/og-default.ts"),
  route("og/*", "routes/og.ts"),
  route("badge/*", "routes/badge.ts"),
  route("healthz", "routes/healthz.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
] satisfies RouteConfig;
