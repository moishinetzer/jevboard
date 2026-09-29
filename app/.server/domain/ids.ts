import { Schema } from "effect";
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** URL-safe random id. 22 base62 chars ≈ 131 bits, 10 chars ≈ 59 bits. */
export const randomId = (length: number): string => {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const byte = bytes[i]!;
    // Rejection sampling keeps the distribution uniform (62 * 4 = 248).
    if (byte < 248) out += ALPHABET[byte % 62];
  }
  return out.length === length ? out : randomId(length);
};

export const EntryId = Schema.String.pipe(Schema.brand("EntryId"));
export type EntryId = typeof EntryId.Type;

/** Order ids appear in URLs and gate the judging page, so they are long and unguessable. */
export const OrderId = Schema.String.pipe(Schema.brand("OrderId"));
export type OrderId = typeof OrderId.Type;

export const JudgmentId = Schema.String.pipe(Schema.brand("JudgmentId"));
export type JudgmentId = typeof JudgmentId.Type;

export const CustomerId = Schema.String.pipe(Schema.brand("CustomerId"));
export type CustomerId = typeof CustomerId.Type;

export const makeEntryId = (): EntryId => EntryId.make(`e${randomId(10)}`);
export const makeOrderId = (): OrderId => OrderId.make(`o${randomId(22)}`);
export const makeJudgmentId = (): JudgmentId => JudgmentId.make(`j${randomId(14)}`);
export const makeCustomerId = (): CustomerId => CustomerId.make(`c${randomId(22)}`);
