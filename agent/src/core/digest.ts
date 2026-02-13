import { createHash } from "node:crypto";
import type { StoredIntent } from "../types.js";

export function canonicalIntentId(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex");
  return `0x${hex}`;
}

export function buildIntentDigest(
  intent: Pick<
    StoredIntent,
    "intentId" | "to" | "token" | "amount" | "memo" | "nonce" | "deadline"
  >,
  chainId: number,
  verifyingContract: string
): string {
  const canonical = [
    intent.intentId.toLowerCase(),
    intent.to.toLowerCase(),
    intent.token.toLowerCase(),
    intent.amount,
    intent.memo,
    String(intent.nonce),
    String(intent.deadline),
    String(chainId),
    verifyingContract.toLowerCase()
  ].join("|");

  const hex = createHash("sha256").update(canonical).digest("hex");
  return `0x${hex}`;
}
