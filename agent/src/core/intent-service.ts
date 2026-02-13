import { randomBytes, randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { buildIntentDigest, canonicalIntentId } from "./digest.js";
import { assertTransition } from "./state-machine.js";
import {
  INTENT_STATUS,
  type ApprovalPayload,
  type ChainSubmitter,
  type CreateIntentInput,
  type StoredIntent
} from "../types.js";
import { IntentStore } from "./intent-store.js";

export interface IntentServiceOptions {
  approvalTokenTtlSec: number;
  chainId: number;
  verifyingContract: string;
  approvalBaseUrl: string;
  autoSubmitOnApprove: boolean;
}

export interface CreatedIntentResult {
  intent: StoredIntent;
  approvalUrl: string;
  telegramPreview: string;
}

export class IntentService {
  private store: IntentStore;
  private chainSubmitter: ChainSubmitter;
  private options: IntentServiceOptions;

  constructor(
    store: IntentStore,
    chainSubmitter: ChainSubmitter,
    options: IntentServiceOptions
  ) {
    this.store = store;
    this.chainSubmitter = chainSubmitter;
    this.options = options;
  }

  async listIntents(): Promise<StoredIntent[]> {
    await this.expireStaleIntents();
    return this.store.list();
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

    const draft: Omit<StoredIntent, "digest"> = {
      intentIdHuman,
      intentId,
      to: input.to,
      token: input.token,
      amount: input.amount,
      memo: input.memo,
      merchantName: input.merchantName,
      itemName: input.itemName,
      nonce,
      deadline,
      status: INTENT_STATUS.PENDING_APPROVAL,
      approvalToken,
      approvalTokenExpiresAt: nowSec + this.options.approvalTokenTtlSec,
      approvalTokenUsedAt: null,
      ownerAuth: null,
      txHash: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const digest = buildIntentDigest(
      draft,
      this.options.chainId,
      this.options.verifyingContract
    );

    const intent: StoredIntent = {
      ...draft,
      digest
    };

    await this.store.create(intent);

    const approvalUrl = `${this.options.approvalBaseUrl}?token=${approvalToken}`;
    const telegramPreview = this.formatTelegramPreview(intent, approvalUrl);

    return { intent, approvalUrl, telegramPreview };
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
      memo: intent.memo,
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
    return updated;
  }

  async approveByToken(
    token: string,
    ownerAuth: string,
    digestEcho: string | undefined
  ): Promise<StoredIntent> {
    const intent = await this.getByActiveApprovalToken(token);
    if (digestEcho && digestEcho !== intent.digest) {
      throw new AppError(400, "DIGEST_MISMATCH", "Approval digest does not match");
    }

    assertTransition(intent.status, INTENT_STATUS.APPROVED_AUTHORIZED);
    const approved: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.APPROVED_AUTHORIZED,
      ownerAuth,
      approvalTokenUsedAt: new Date().toISOString(),
      approvalToken: null,
      updatedAt: new Date().toISOString()
    };

    await this.store.update(approved);

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

    const submitting: StoredIntent = {
      ...intent,
      status: INTENT_STATUS.SUBMITTED,
      updatedAt: new Date().toISOString()
    };
    await this.store.update(submitting);

    try {
      const result = await this.chainSubmitter.submit(submitting);
      const executed: StoredIntent = {
        ...submitting,
        status: INTENT_STATUS.EXECUTED,
        txHash: result.txHash,
        updatedAt: new Date().toISOString()
      };
      await this.store.update(executed);
      return executed;
    } catch (error) {
      const failed: StoredIntent = {
        ...submitting,
        status: INTENT_STATUS.FAILED,
        errorCode: error instanceof Error ? error.message : "UNKNOWN_CHAIN_ERROR",
        updatedAt: new Date().toISOString()
      };
      await this.store.update(failed);
      return failed;
    }
  }

  private async getByActiveApprovalToken(token: string): Promise<StoredIntent> {
    const intent = this.store.getByApprovalToken(token);
    if (!intent) {
      throw new AppError(404, "APPROVAL_TOKEN_NOT_FOUND", "Approval token is invalid");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!intent.approvalTokenExpiresAt || intent.approvalTokenExpiresAt < nowSec) {
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
}
