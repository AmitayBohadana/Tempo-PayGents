import { randomBytes } from "node:crypto";
import { AbiCoder, recoverAddress } from "ethers";
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
    if (!intent.ownerAuth) {
      throw new Error("OWNER_AUTH_MISSING");
    }

    const decoded = AbiCoder.defaultAbiCoder().decode(["address", "bytes"], intent.ownerAuth);
    const signer = decoded[0] as string;
    const signature = decoded[1] as string;
    const recovered = recoverAddress(intent.digest, signature);
    if (recovered.toLowerCase() !== signer.toLowerCase()) {
      throw new Error("OWNER_AUTH_INVALID_SIGNATURE");
    }

    const txHash = `0x${randomBytes(32).toString("hex")}`;
    return { txHash };
  }
}
