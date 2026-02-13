import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isHexString,
  keccak256,
  solidityPacked
} from "ethers";

const vaultAbi = [
  "function ownerRef() view returns (bytes32)",
  "function maxAmountPerPayment() view returns (uint256)",
  "function recipientAllowlistEnforced() view returns (bool)",
  "function setOwnerRef(bytes32 ownerRefValue)",
  "function setMaxAmountPerPayment(uint256 amount)",
  "function setTokenAllowed(address token, bool allowed)",
  "function setRecipientAllowed(address recipient, bool allowed)",
  "function setRecipientAllowlistEnforced(bool enabled)"
];

async function main() {
  const rpcUrl = requiredEnv("EVM_RPC_URL");
  const ownerPrivateKey = requiredEnv("EVM_OWNER_PRIVATE_KEY");
  const vaultAddress = getAddress(requiredEnv("VAULT_CONTRACT_ADDRESS"));
  const expectedChainId = Number(process.env.EVM_CHAIN_ID ?? process.env.CHAIN_ID ?? 42431);

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== expectedChainId) {
    throw new Error(
      `CHAIN_ID_MISMATCH expected=${expectedChainId} actual=${network.chainId.toString()}`
    );
  }

  const signer = new Wallet(ownerPrivateKey, provider);
  const vault = new Contract(vaultAddress, vaultAbi, signer);

  const txHashes: string[] = [];

  const ownerRef = resolveOwnerRefOptional();
  if (ownerRef) {
    const tx = await vault.setOwnerRef(ownerRef);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  if (process.env.MAX_AMOUNT_BASE_UNITS) {
    const tx = await vault.setMaxAmountPerPayment(process.env.MAX_AMOUNT_BASE_UNITS);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  for (const token of parseAddressList(process.env.ALLOWED_TOKENS)) {
    const tx = await vault.setTokenAllowed(token, true);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  for (const recipient of parseAddressList(process.env.ALLOWED_RECIPIENTS)) {
    const tx = await vault.setRecipientAllowed(recipient, true);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  if (process.env.RECIPIENT_ALLOWLIST_ENFORCED !== undefined) {
    const enabled = parseBoolean(process.env.RECIPIENT_ALLOWLIST_ENFORCED);
    const tx = await vault.setRecipientAllowlistEnforced(enabled);
    await tx.wait(1);
    txHashes.push(tx.hash);
  }

  const [currentOwnerRef, currentMaxAmount, currentRecipientAllowlistEnforced] =
    await Promise.all([
      vault.ownerRef(),
      vault.maxAmountPerPayment(),
      vault.recipientAllowlistEnforced()
    ]);

  console.log(
    JSON.stringify(
      {
        chainId: Number(network.chainId),
        vaultAddress,
        operator: signer.address,
        txHashes,
        currentOwnerRef,
        currentMaxAmount: currentMaxAmount.toString(),
        currentRecipientAllowlistEnforced
      },
      null,
      2
    )
  );
}

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => getAddress(item));
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Boolean env values must be 'true' or 'false'");
}

function resolveOwnerRefOptional(): string | null {
  const explicitOwnerRef = process.env.OWNER_REF;
  if (explicitOwnerRef) {
    if (!isHexString(explicitOwnerRef, 32)) {
      throw new Error("OWNER_REF must be a 32-byte hex string");
    }
    return explicitOwnerRef.toLowerCase();
  }

  const ownerSignerPrivateKey = process.env.OWNER_SIGNER_PRIVATE_KEY;
  if (ownerSignerPrivateKey) {
    const ownerSigner = new Wallet(ownerSignerPrivateKey);
    return keccak256(solidityPacked(["address"], [ownerSigner.address]));
  }

  const relaySignerAddress = process.env.RELAY_SIGNER_ADDRESS;
  if (relaySignerAddress) {
    return keccak256(solidityPacked(["address"], [getAddress(relaySignerAddress)]));
  }

  return null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
