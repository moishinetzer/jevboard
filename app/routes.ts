import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // Verdict page per defendant: /s/acme.com, /s/github.com/acme
  route("s/*", "routes/entry.tsx"),
  // POST-only: "Get judged — $5" / "Demand a retrial — $5"
  route("judge", "routes/judge.tsx"),
  route("judging/:orderId", "routes/judging.tsx"),
  route("hall", "routes/hall.tsx"),
  route("stats", "routes/stats.tsx"),
  route("faq", "routes/faq.tsx"),
  route("terms", "routes/terms.tsx"),
  route("tv", "routes/tv.tsx"),
  // Local checkout simulator (only active without AUTUMN_SECRET_KEY)
  route("dev/checkout/:orderId", "routes/dev-checkout.tsx"),
  // Resource routes
  route("go/*", "routes/go.ts"),
  route("api/feed", "routes/api.feed.ts"),
  // Autumn (Svix-signed) payment webhook
  route("api/autumn/webhook", "routes/api.autumn-webhook.ts"),
  route("og.png", "routes/og-default.ts"),
  route("og/*", "routes/og.ts"),
  route("badge/*", "routes/badge.ts"),
  route("healthz", "routes/healthz.ts"),
] satisfies RouteConfig;
