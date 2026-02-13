import { randomBytes, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { buildIntentDigest, canonicalIntentId } from "./digest.js";
import { memoToBytes32, parseAmountToBaseUnits } from "./intent-encoding.js";
import { type OwnerAuthAdapter } from "./owner-auth.js";
import { assertTransition } from "./state-machine.js";
import {
  INTENT_STATUS,
  type ApprovalPayload,
  type ChainSubmitter,
  type CreateIntentInput,
  type PolicyConfig,
  type PolicyPatch,
  type StoredIntent
} from "../types.js";
import { IntentStore } from "./intent-store.js";

export interface IntentServiceOptions {
  approvalTokenTtlSec: number;
  chainId: number;
  verifyingContract: string;
  tokenDecimals: number;
  approvalBaseUrl: string;
  autoSubmitOnApprove: boolean;
}

export interface CreatedIntentResult {
  intent: StoredIntent;
  approvalUrl: string;
  telegramPreview: string;
}

export interface OutboundMessage {
  channel: "telegram";
  type: "text";
  body: string;
}

export class IntentService {
  private store: IntentStore;
  private chainSubmitter: ChainSubmitter;
  private ownerAuthAdapter: OwnerAuthAdapter;
  private options: IntentServiceOptions;

  constructor(
    store: IntentStore,
    chainSubmitter: ChainSubmitter,
    ownerAuthAdapter: OwnerAuthAdapter,
    options: IntentServiceOptions
  ) {
    this.store = store;
    this.chainSubmitter = chainSubmitter;
    this.ownerAuthAdapter = ownerAuthAdapter;
    this.options = options;
  }

  async listIntents(): Promise<StoredIntent[]> {
    await this.expireStaleIntents();
    return this.store.list();
  }

  getPolicy(): PolicyConfig {
    return this.store.getPolicy();
  }

  async updatePolicy(patch: PolicyPatch): Promise<PolicyConfig> {
    const next: PolicyPatch = { ...patch };

    if (next.maxAmount !== undefined && next.maxAmount !== null) {
      const parsed = Number(next.maxAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new AppError(400, "INVALID_MAX_AMOUNT", "maxAmount must be > 0");
      }
    }

    if (next.allowedTokens) {
      next.allowedTokens = normalizeAddressArray(next.allowedTokens);
    }

    if (next.allowedRecipients) {
      next.allowedRecipients = normalizeAddressArray(next.allowedRecipients);
    }

    return this.store.updatePolicy(next);
  }

  async getIntent(intentId: string): Promise<StoredIntent> {
    await this.expireStaleIntents();
    const intent = this.store.get(intentId);
    if (!intent) {
      throw new AppError(404, "INTENT_NOT_FOUND", `Intent ${intentId} was not found`);
    }
    return intent;
  }

  async createIntent(input: CreateIntentInput): Promise<CreatedIntentResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const deadline = input.deadline ?? nowSec + this.options.approvalTokenTtlSec;
    if (deadline <= nowSec) {
      throw new AppError(400, "INVALID_DEADLINE", "Deadline must be in the future");
    }

    const intentIdHuman = randomUUID();
    const intentId = canonicalIntentId(intentIdHuman);
    const nonce = this.store.nextNonce();
    const approvalToken = randomBytes(32).toString("hex");

    const normalizedTo = input.to.toLowerCase();
    const normalizedToken = input.token.toLowerCase();
    const amountBaseUnits = parseAmountToBaseUnits(input.amount, this.options.tokenDecimals);
    const memoHash = memoToBytes32(input.memo);

    const draft: Omit<StoredIntent, "digest"> = {
      intentIdHuman,
      intentId,
      to: normalizedTo,
      token: normalizedToken,
      amount: input.amount,
      amountBaseUnits,
      memo: input.memo,
      memoHash,
      merchantName: input.merchantName,
      itemName: input.itemName,
      nonce,
      deadline,
      status: INTENT_STATUS.PENDING_APPROVAL,
      approvalToken,
      approvalTokenExpiresAt: nowSec + this.options.approvalTokenTtlSec,
      approvalTokenUsedAt: null,
      ownerAuthArtifact: null,
      ownerAuth: null,
      txHash: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const digest = buildIntentDigest(
      draft,
      this.options.chainId,
      this.options.verifyingContract,
      this.options.tokenDecimals
    );

    const intent: StoredIntent = {
      ...draft,
      digest
    };

    this.assertPolicy(intent);
    await this.store.create(intent);

    const approvalUrl = `${this.options.approvalBaseUrl}?token=${approvalToken}`;
    const telegramPreview = this.formatTelegramPreview(intent, approvalUrl);
    this.logEvent("INTENT_CREATED", {
      intentId: intent.intentId,
      status: intent.status,
      nonce: intent.nonce
    });

    return { intent, approvalUrl, telegramPreview };
  }

  buildOutboundMessages(intentId: string): OutboundMessage[] {
    const intent = this.store.get(intentId);
    if (!intent) {
      throw new AppError(404, "INTENT_NOT_FOUND", `Intent ${intentId} was not found`);
    }

    const approvalUrl = intent.approvalToken
      ? `${this.options.approvalBaseUrl}?token=${intent.approvalToken}`
      : "(approval token consumed)";

    return [
      {
        channel: "telegram",
        type: "text",
        body: this.formatTelegramPreview(intent, approvalUrl)
      }
    ];
  }

  async getApprovalPayload(token: string): Promise<ApprovalPayload> {
    await this.expireStaleIntents();
    const intent = await this.getByActiveApprovalToken(token);

    return {
      intentId: intent.intentId,
      intentIdHuman: intent.intentIdHuman,
      to: intent.to,
      token: intent.token,
      amount: intent.amount,
      amountBaseUnits:
        intent.amountBaseUnits ??
        parseAmountToBaseUnits(intent.amount, this.options.tokenDecimals),
      memo: intent.memo,
      memoHash: intent.memoHash ?? memoToBytes32(intent.memo),
      merchantName: intent.merchantName,
      itemName: intent.itemName,
      deadline: intent.deadline,
      digest: intent.digest,
      expiresAt: intent.approvalTokenExpiresAt ?? intent.deadline
    };
  }

  async rejectApproval(token: string): Promise<StoredIntent> {
    const intent = await this.getByActiveApprovalToken(token);
    assertTransition(intent.status, INTENT_STATUS.REJECTED);

    const updated: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.REJECTED,
      approvalTokenUsedAt: new Date().toISOString(),
      approvalToken: null,
      updatedAt: new Date().toISOString()
    };

    await this.store.update(updated);
    this.logEvent("INTENT_REJECTED", {
      intentId: updated.intentId,
      status: updated.status
    });
    return updated;
  }

  async approveByToken(
    token: string,
    ownerAuthArtifact: string,
    digestEcho: string | undefined
  ): Promise<StoredIntent> {
    const intent = await this.getByActiveApprovalToken(token);
    if (digestEcho && digestEcho !== intent.digest) {
      throw new AppError(400, "DIGEST_MISMATCH", "Approval digest does not match");
    }
    const contractOwnerAuth = this.ownerAuthAdapter.toContractOwnerAuth(
      ownerAuthArtifact,
      intent.digest
    );

    assertTransition(intent.status, INTENT_STATUS.APPROVED_AUTHORIZED);
    const approved: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.APPROVED_AUTHORIZED,
      ownerAuthArtifact,
      ownerAuth: contractOwnerAuth,
      approvalTokenUsedAt: new Date().toISOString(),
      approvalToken: null,
      updatedAt: new Date().toISOString()
    };

    await this.store.update(approved);
    this.logEvent("INTENT_APPROVED", {
      intentId: approved.intentId,
      status: approved.status
    });

    if (this.options.autoSubmitOnApprove) {
      return this.submitIntent(approved.intentId);
    }

    return approved;
  }

  async submitIntent(intentId: string): Promise<StoredIntent> {
    await this.expireStaleIntents();
    const intent = await this.getIntent(intentId);
    if (intent.status !== INTENT_STATUS.APPROVED_AUTHORIZED) {
      throw new AppError(
        409,
        "INTENT_NOT_READY_FOR_SUBMISSION",
        `Intent ${intent.intentId} is in ${intent.status}`
      );
    }

    this.assertPolicy(intent);
    const submitting: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.SUBMITTED,
      updatedAt: new Date().toISOString()
    };
    await this.store.update(submitting);
    this.logEvent("INTENT_SUBMITTED", {
      intentId: submitting.intentId,
      status: submitting.status
    });

    try {
      const result = await this.chainSubmitter.submit(submitting);
      const executed: StoredIntent = {
        ...submitting,
        status: INTENT_STATUS.EXECUTED,
        txHash: result.txHash,
        updatedAt: new Date().toISOString()
      };
      await this.store.update(executed);
      this.logEvent("INTENT_EXECUTED", {
        intentId: executed.intentId,
        status: executed.status,
        txHash: executed.txHash
      });
      return executed;
    } catch (error) {
      const failed: StoredIntent = {
        ...submitting,
        status: INTENT_STATUS.FAILED,
        errorCode: error instanceof Error ? error.message : "UNKNOWN_CHAIN_ERROR",
        updatedAt: new Date().toISOString()
      };
      await this.store.update(failed);
      this.logEvent("INTENT_FAILED", {
        intentId: failed.intentId,
        status: failed.status,
        errorCode: failed.errorCode
      });
      return failed;
    }
  }

  private async getByActiveApprovalToken(token: string): Promise<StoredIntent> {
    const intent = this.store.getByApprovalToken(token);
    if (!intent) {
      throw new AppError(404, "APPROVAL_TOKEN_NOT_FOUND", "Approval token is invalid");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (intent.deadline < nowSec) {
      await this.markIntentExpired(intent);
      throw new AppError(410, "INTENT_DEADLINE_EXPIRED", "Intent deadline expired");
    }

    if (!intent.approvalTokenExpiresAt || intent.approvalTokenExpiresAt < nowSec) {
      await this.markIntentExpired(intent);
      throw new AppError(410, "APPROVAL_TOKEN_EXPIRED", "Approval token expired");
    }

    if (intent.status !== INTENT_STATUS.PENDING_APPROVAL) {
      throw new AppError(
        409,
        "APPROVAL_TOKEN_ALREADY_USED",
        `Approval is already ${intent.status}`
      );
    }

    return intent;
  }

  private async markIntentExpired(intent: StoredIntent): Promise<void> {
    if (intent.status !== INTENT_STATUS.PENDING_APPROVAL) {
      return;
    }

    const expired: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.EXPIRED,
      approvalToken: null,
      updatedAt: new Date().toISOString()
    };
    await this.store.update(expired);
    this.logEvent("INTENT_EXPIRED", {
      intentId: expired.intentId,
      status: expired.status
    });
  }

  private async expireStaleIntents(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const intents = this.store.list();

    for (const intent of intents) {
      if (
        intent.deadline < nowSec &&
        (intent.status === INTENT_STATUS.PENDING_APPROVAL ||
          intent.status === INTENT_STATUS.APPROVED_AUTHORIZED)
      ) {
        const expired: StoredIntent = {
          ...intent,
          status: INTENT_STATUS.EXPIRED,
          approvalToken: null,
          updatedAt: new Date().toISOString()
        };
        await this.store.update(expired);
        this.logEvent("INTENT_EXPIRED", {
          intentId: expired.intentId,
          status: expired.status
        });
      }
    }
  }

  private formatTelegramPreview(intent: StoredIntent, approvalUrl: string): string {
    const now = Math.floor(Date.now() / 1000);
    const secondsLeft = Math.max(intent.deadline - now, 0);
    const minutes = Math.floor(secondsLeft / 60);

    const lines = [
      "Purchase intent ready:",
      intent.itemName ? `Item: ${intent.itemName}` : "Item: N/A",
      intent.merchantName ? `Store: ${intent.merchantName}` : "Store: N/A",
      `Total: ${intent.amount} (${intent.token})`,
      `Pay to: ${intent.to}`,
      `Memo: ${intent.memo}`,
      `Expires in: ${minutes} min`,
      "",
      `Approve: ${approvalUrl}`,
      "Reject: Open the same page and tap Reject"
    ];

    return lines.join("\n");
  }

  private assertPolicy(
    intent: Pick<StoredIntent, "amount" | "token" | "to" | "intentId">
  ): void {
    const policy = this.store.getPolicy();
    const amount = Number(intent.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, "INVALID_AMOUNT", "Intent amount must be numeric and > 0");
    }

    if (policy.maxAmount !== null && amount > Number(policy.maxAmount)) {
      throw new AppError(
        403,
        "POLICY_MAX_AMOUNT_EXCEEDED",
        `Intent ${intent.intentId} exceeds maxAmount policy`
      );
    }

    if (policy.tokenAllowlistEnforced) {
      const allowed = new Set(policy.allowedTokens.map((token) => token.toLowerCase()));
      if (!allowed.has(intent.token.toLowerCase())) {
        throw new AppError(
          403,
          "POLICY_TOKEN_NOT_ALLOWED",
          `Token ${intent.token} is not allowed by policy`
        );
      }
    }

    if (policy.recipientAllowlistEnforced) {
      const allowed = new Set(
        policy.allowedRecipients.map((recipient) => recipient.toLowerCase())
      );
      if (!allowed.has(intent.to.toLowerCase())) {
        throw new AppError(
          403,
          "POLICY_RECIPIENT_NOT_ALLOWED",
          `Recipient ${intent.to} is not allowed by policy`
        );
      }
    }
  }

  private logEvent(event: string, fields: Record<string, unknown>): void {
    const payload = {
      event,
      ts: new Date().toISOString(),
      ...fields
    };
    console.log(JSON.stringify(payload));
  }
}

function normalizeAddressArray(addresses: string[]): string[] {
  const unique = new Set<string>();
  for (const value of addresses) {
    const normalized = value.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new AppError(
        400,
        "INVALID_ADDRESS",
        `Invalid address in policy list: ${value}`
      );
    }
    unique.add(normalized);
  }
  return [...unique];
}
