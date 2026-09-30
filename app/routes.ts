import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // The board with one business opened: /s/acme.com, /s/github.com/acme
  route("s/*", "routes/entry.tsx"),
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
  route("og.png", "routes/og-default.ts"),
  route("og/*", "routes/og.ts"),
  route("badge/*", "routes/badge.ts"),
  route("healthz", "routes/healthz.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
] satisfies RouteConfig;
