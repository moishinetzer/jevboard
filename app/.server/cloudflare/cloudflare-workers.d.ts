// Minimal typing for the Workers runtime module (avoids pulling the global
// @cloudflare/workers-types declarations into the DOM/Node-typed app).
declare module "cloudflare:workers" {
  export const env: import("./env").Env;
}
