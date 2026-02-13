import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import type { ChainSubmissionResult, ChainSubmitter, StoredIntent } from "../types.js";

const vaultAbi = [
  "function executeAuthorizedPayment((bytes32 intentId,address to,address token,uint256 amount,bytes32 memo,uint256 nonce,uint256 deadline) intent, bytes ownerAuth) external"
];

export interface EvmChainSubmitterOptions {
  rpcUrl: string;
  relayerPrivateKey: string;
  vaultAddress: string;
  confirmations: number;
}

export class EvmChainSubmitter implements ChainSubmitter {
  private contract: Contract;
  private confirmations: number;

  constructor(options: EvmChainSubmitterOptions) {
    const provider = new JsonRpcProvider(options.rpcUrl);
    const signer = new Wallet(options.relayerPrivateKey, provider);
    this.contract = new Contract(getAddress(options.vaultAddress), vaultAbi, signer);
    this.confirmations = options.confirmations;
  }

  async submit(intent: StoredIntent): Promise<ChainSubmissionResult> {
    if (!intent.ownerAuth) {
      throw new Error("OWNER_AUTH_MISSING");
    }
    if (!intent.amountBaseUnits) {
      throw new Error("AMOUNT_BASE_UNITS_MISSING");
    }
    if (!intent.memoHash) {
      throw new Error("MEMO_HASH_MISSING");
    }

    const tx = await this.contract.executeAuthorizedPayment(
      {
        intentId: intent.intentId,
        to: getAddress(intent.to),
        token: getAddress(intent.token),
        amount: intent.amountBaseUnits,
        memo: intent.memoHash,
        nonce: intent.nonce,
        deadline: intent.deadline
      },
      intent.ownerAuth
    );

    await tx.wait(this.confirmations);
    return { txHash: tx.hash };
  }
}
