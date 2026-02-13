import { keccak256, toUtf8Bytes } from "ethers";
import { AppError } from "./errors.js";

export function parseAmountToBaseUnits(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AppError(500, "INVALID_TOKEN_DECIMALS", "TOKEN_DECIMALS must be 0..36");
  }

  const normalized = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new AppError(
      400,
      "INVALID_AMOUNT_FORMAT",
      "Amount must be a positive decimal string"
    );
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > decimals) {
    throw new AppError(
      400,
      "INVALID_AMOUNT_PRECISION",
      `Amount has more than ${decimals} decimal places`
    );
  }

  const base = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart);
  const fractionPadded = fractionalPart.padEnd(decimals, "0");
  const fraction = fractionPadded.length > 0 ? BigInt(fractionPadded) : 0n;
  const units = whole * base + fraction;

  if (units <= 0n) {
    throw new AppError(400, "INVALID_AMOUNT", "Intent amount must be > 0");
  }

  return units.toString();
}

export function memoToBytes32(memo: string): string {
  return keccak256(toUtf8Bytes(memo));
}
