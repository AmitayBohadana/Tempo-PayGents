import { AppError } from "./errors.js";
import { INTENT_STATUS, type IntentStatus } from "../types.js";

const transitions: Record<IntentStatus, IntentStatus[]> = {
  [INTENT_STATUS.PENDING_APPROVAL]: [
    INTENT_STATUS.APPROVED_AUTHORIZED,
    INTENT_STATUS.EXECUTED,
    INTENT_STATUS.EXPIRED,
    INTENT_STATUS.REJECTED
  ],
  [INTENT_STATUS.APPROVED_AUTHORIZED]: [
    INTENT_STATUS.SUBMITTED,
    INTENT_STATUS.EXPIRED
  ],
  [INTENT_STATUS.SUBMITTED]: [INTENT_STATUS.EXECUTED, INTENT_STATUS.FAILED],
  [INTENT_STATUS.EXECUTED]: [],
  [INTENT_STATUS.FAILED]: [],
  [INTENT_STATUS.EXPIRED]: [],
  [INTENT_STATUS.REJECTED]: []
};

export function assertTransition(from: IntentStatus, to: IntentStatus): void {
  if (from === to) {
    return;
  }

  const allowed = transitions[from];
  if (!allowed.includes(to)) {
    throw new AppError(
      409,
      "INVALID_STATE_TRANSITION",
      `Cannot transition intent from ${from} to ${to}`
    );
  }
}
