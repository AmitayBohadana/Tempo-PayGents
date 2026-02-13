import { randomBytes } from "node:crypto";
import type { ChainSubmissionResult, ChainSubmitter, StoredIntent } from "../types.js";

export class MockChainSubmitter implements ChainSubmitter {
  private latencyMs: number;

  constructor(latencyMs = 1200) {
    this.latencyMs = latencyMs;
  }

  async submit(intent: StoredIntent): Promise<ChainSubmissionResult> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    const now = Math.floor(Date.now() / 1000);
    if (intent.deadline < now) {
      throw new Error("INTENT_EXPIRED");
    }

    const txHash = `0x${randomBytes(32).toString("hex")}`;
    return { txHash };
  }
}
