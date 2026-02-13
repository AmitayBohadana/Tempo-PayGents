export const INTENT_STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED_AUTHORIZED: "APPROVED_AUTHORIZED",
  SUBMITTED: "SUBMITTED",
  EXECUTED: "EXECUTED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  REJECTED: "REJECTED"
} as const;

export type IntentStatus = (typeof INTENT_STATUS)[keyof typeof INTENT_STATUS];

export interface CreateIntentInput {
  to: string;
  token: string;
  amount: string;
  memo: string;
  merchantName?: string;
  itemName?: string;
  deadline?: number;
}

export interface StoredIntent {
  intentIdHuman: string;
  intentId: string;
  to: string;
  token: string;
  amount: string;
  memo: string;
  merchantName?: string;
  itemName?: string;
  nonce: number;
  deadline: number;
  digest: string;
  status: IntentStatus;
  approvalToken: string | null;
  approvalTokenExpiresAt: number | null;
  approvalTokenUsedAt: string | null;
  ownerAuth: string | null;
  txHash: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntentDatabase {
  version: number;
  nextNonce: number;
  intents: StoredIntent[];
}

export interface ApprovalPayload {
  intentId: string;
  intentIdHuman: string;
  to: string;
  token: string;
  amount: string;
  memo: string;
  merchantName?: string;
  itemName?: string;
  deadline: number;
  digest: string;
  expiresAt: number;
}

export interface ChainSubmissionResult {
  txHash: string;
}

export interface ChainSubmitter {
  submit(intent: StoredIntent): Promise<ChainSubmissionResult>;
}
