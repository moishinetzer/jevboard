import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { AppConfig } from "../../config";

/**
 * The one place Jev touches the network: a single Messages API request,
 * streamed, resolved with the final message.
 *
 * Kept deliberately tiny so tests can swap in canned `BetaMessage`s (or throw
 * SDK errors) without an API key. The `signal` comes from `Effect.tryPromise`,
 * so interrupting the judging fiber aborts the HTTP request.
 */
export class AnthropicMessages extends Context.Service<
  AnthropicMessages,
  {
    readonly send: (params: BetaMessageStreamParams, options: { readonly signal: AbortSignal }) => Promise<BetaMessage>;
  }
>()("jevboard/judge/AnthropicMessages") {
  /** Streaming (`.stream().finalMessage()`) avoids HTTP timeouts on long, tool-using turns. */
  static readonly fromClient = (client: Anthropic) =>
    AnthropicMessages.of({
      send: (params, { signal }) => client.beta.messages.stream(params, { signal }).finalMessage(),
    });

  /** Real client from `ANTHROPIC_API_KEY`; without a key every call rejects (the judge reports a config error first). */
  static readonly layer = Layer.effect(
    AnthropicMessages,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return Option.match(config.anthropic, {
        onNone: () =>
          AnthropicMessages.of({
            send: () => Promise.reject(new Anthropic.AnthropicError("ANTHROPIC_API_KEY is not configured")),
          }),
        onSome: ({ apiKey }) =>
          AnthropicMessages.fromClient(
            new Anthropic({
              apiKey: Redacted.value(apiKey),
              // The SDK retries 408/409/429/5xx and connection errors itself, honouring retry-after.
              maxRetries: 2,
            }),
          ),
      });
    }),
  );

  /** Canned responses for tests. */
  static readonly layerTest = (send: AnthropicMessages["Service"]["send"]) =>
    Layer.succeed(AnthropicMessages, AnthropicMessages.of({ send }));
}
