import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import type { ChainSubmissionResult, ChainSubmitter, StoredIntent } from "../types.js";

const vaultAbi = [
  "function executeAuthorizedPayment((bytes32 intentId,address to,address token,uint256 amount,bytes32 memo,uint256 nonce,uint256 deadline) intent, bytes ownerAuth) external"
];

export interface EvmChainSubmitterOptions {
  rpcUrl: string;
  relayerPrivateKey: string;
  vaultAddress: string;
  expectedChainId: number;
  confirmations: number;
}

export class EvmChainSubmitter implements ChainSubmitter {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private expectedChainId: number;
  private confirmations: number;

  constructor(options: EvmChainSubmitterOptions) {
    const provider = new JsonRpcProvider(options.rpcUrl);
    this.provider = provider;
    const signer = new Wallet(options.relayerPrivateKey, provider);
    this.contract = new Contract(getAddress(options.vaultAddress), vaultAbi, signer);
    this.expectedChainId = options.expectedChainId;
    this.confirmations = options.confirmations;
  }

  async submit(intent: StoredIntent): Promise<ChainSubmissionResult> {
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.expectedChainId) {
      throw new Error(
        `CHAIN_ID_MISMATCH expected=${this.expectedChainId} actual=${network.chainId.toString()}`
      );
    }

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
