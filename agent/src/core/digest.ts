import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { StoredIntent } from "../types.js";
import { parseAmountToBaseUnits } from "./intent-encoding.js";

export function canonicalIntentId(input: string): string {
  return keccak256(toUtf8Bytes(input));
}

export function buildIntentDigest(
  intent: Pick<
    StoredIntent,
    | "intentId"
    | "to"
    | "token"
    | "amount"
    | "amountBaseUnits"
    | "memo"
    | "memoHash"
    | "nonce"
    | "deadline"
  >,
  chainId: number,
  verifyingContract: string,
  tokenDecimals: number
): string {
  const typeHash = keccak256(
    toUtf8Bytes(
      "PaymentIntent(bytes32 intentId,address to,address token,uint256 amount,bytes32 memo,uint256 nonce,uint256 deadline,uint256 chainId,address verifyingContract)"
    )
  );

  const amountBaseUnits =
    intent.amountBaseUnits ?? parseAmountToBaseUnits(intent.amount, tokenDecimals);
  const memoHash = intent.memoHash ?? keccak256(toUtf8Bytes(intent.memo));

  const encoded = AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "bytes32",
      "address",
      "address",
      "uint256",
      "bytes32",
      "uint256",
      "uint256",
      "uint256",
      "address"
    ],
    [
      typeHash,
      intent.intentId,
      getAddress(intent.to),
      getAddress(intent.token),
      amountBaseUnits,
      memoHash,
      intent.nonce,
      intent.deadline,
      chainId,
      getAddress(verifyingContract)
    ]
  );

  return keccak256(encoded);
}
