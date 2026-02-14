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
  /** Tenant owning this intent. Undefined/null indicates legacy single-tenant mode. */
  botId?: string | null;
  to: string;
  token: string;
  amount: string;
  amountBaseUnits?: string;
  memo: string;
  memoHash?: string;
  merchantName?: string;
  itemName?: string;
  nonce: number;
  deadline: number;
  digest: string;
  status: IntentStatus;
  approvalToken: string | null;
  approvalTokenExpiresAt: number | null;
  approvalTokenUsedAt: string | null;
  ownerAuthArtifact?: string | null;
  ownerAuth: string | null;
  txHash: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyConfig {
  maxAmount: string | null;
  tokenAllowlistEnforced: boolean;
  recipientAllowlistEnforced: boolean;
  allowedTokens: string[];
  allowedRecipients: string[];
}

export interface PolicyPatch {
  maxAmount?: string | null;
  tokenAllowlistEnforced?: boolean;
  recipientAllowlistEnforced?: boolean;
  allowedTokens?: string[];
  allowedRecipients?: string[];
}

export interface StoredPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  /** Tenant scope for notifications. "global" receives notifications for all tenants. */
  botId?: string | "global";
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface IntentDatabase {
  version: number;
  nextNonce: number;
  intents: StoredIntent[];
  /** Legacy global policy (single-tenant). */
  policy: PolicyConfig;
  /** Multi-tenant policies by botId. */
  policiesByBotId?: Record<string, PolicyConfig>;
  pushSubscriptions: StoredPushSubscription[];
}

export interface Tenant {
  apiKey: string;
  botId: string;
  createdAt: string;
}

export interface TenantDatabase {
  version: number;
  tenants: Tenant[];
}

export interface ApprovalPayload {
  intentId: string;
  intentIdHuman: string;
  to: string;
  token: string;
  amount: string;
  amountBaseUnits: string;
  memo: string;
  memoHash: string;
  merchantName?: string;
  itemName?: string;
  nonce: number;
  deadline: number;
  digest: string;
  expiresAt: number;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  approvalUrl: string;
  intentId: string;
  botId?: string | null;
}

export interface ChainSubmissionResult {
  txHash: string;
}

export interface ChainSubmitter {
  submit(intent: StoredIntent): Promise<ChainSubmissionResult>;
}
