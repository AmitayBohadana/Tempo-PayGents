import {
  AbiCoder,
  Wallet,
  getAddress,
  keccak256,
  isHexString,
  solidityPacked
} from "ethers";
import { AppError } from "./errors.js";

interface OwnerApprovalArtifact {
  digest?: string;
  approvedAt?: string;
  method?: string;
}

export interface OwnerAuthAdapter {
  toContractOwnerAuth(ownerAuthArtifact: string, digest: string): string;
  getSignerAddress(): string;
  getOwnerRef(): string;
}

export class RelaySignerOwnerAuthAdapter implements OwnerAuthAdapter {
  private wallet: Wallet;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
  }

  toContractOwnerAuth(ownerAuthArtifact: string, digest: string): string {
    const parsedDigest = normalizeDigest(digest);
    const artifact = parseOwnerApprovalArtifact(ownerAuthArtifact);

    if (artifact.digest && normalizeDigest(artifact.digest) !== parsedDigest) {
      throw new AppError(
        400,
        "DIGEST_MISMATCH",
        "Approval artifact digest does not match intent digest"
      );
    }

    const signature = this.wallet.signingKey.sign(parsedDigest).serialized;
    return AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes"],
      [this.wallet.address, signature]
    );
  }

  getSignerAddress(): string {
    return getAddress(this.wallet.address);
  }

  getOwnerRef(): string {
    return keccak256(solidityPacked(["address"], [this.wallet.address]));
  }
}

function parseOwnerApprovalArtifact(ownerAuthArtifact: string): OwnerApprovalArtifact {
  try {
    const decoded = Buffer.from(ownerAuthArtifact, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as OwnerApprovalArtifact;
    return parsed;
  } catch {
    throw new AppError(
      400,
      "INVALID_OWNER_AUTH_ARTIFACT",
      "Owner auth artifact is not a valid base64 JSON payload"
    );
  }
}

function normalizeDigest(value: string): string {
  if (!isHexString(value, 32)) {
    throw new AppError(400, "INVALID_DIGEST", "Digest must be a 32-byte hex string");
  }
  return value.toLowerCase();
}
